import {bytes,canonical,check,hash,id,orderState,validate} from './domain.js'

export function base64(data) {
  let binary=''
  for(let i=0;i<data.length;i+=8192) binary+=String.fromCharCode(...data.subarray(i,i+8192))
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
}
export function unbase64(value) {
  check(typeof value==='string' && /^[A-Za-z0-9_-]+$/.test(value),'暗号化データの形式が無効です。')
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
}
const random = n => crypto.getRandomValues(new Uint8Array(n))
const AES = 'AES-GCM'
const ITERATIONS=600000
const input = value => bytes(canonical(value))
const parse = data => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data))
async function passKey(phrase,salt) {
  const base=await crypto.subtle.importKey('raw',bytes(phrase.normalize('NFC')),'PBKDF2',false,['deriveKey'])
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},base,{name:AES,length:256},false,['encrypt','decrypt'])
}
const importRoot = raw => crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey'])
const headerAAD = h => input([1,'vault',h.datasetId,h.objectId,h.kdf,h.salt,h.iterations])
export async function newVault(phrase) {
  check([...phrase.normalize('NFC')].length>=12,'パスフレーズは12文字以上で設定してください。')
  const salt=random(16),iv=random(12),raw=random(32)
  const header={formatVersion:1,objectType:'vault',datasetId:id(),objectId:id(),kdf:'PBKDF2-HMAC-SHA-256',iterations:ITERATIONS,salt:base64(salt),iv:base64(iv)}
  try {
    const key=await passKey(phrase,salt)
    header.ciphertext=base64(new Uint8Array(await crypto.subtle.encrypt({name:AES,iv,additionalData:headerAAD(header),tagLength:128},key,raw)))
    return {header,root:await importRoot(raw)}
  } finally { raw.fill(0) }
}
export async function unlock(header,phrase) {
  check(header?.formatVersion===1 && header.objectType==='vault' && header.iterations===ITERATIONS && header.kdf==='PBKDF2-HMAC-SHA-256' && typeof header.datasetId==='string' && typeof header.objectId==='string','保管庫の鍵形式が無効です。')
  const salt=unbase64(header.salt),iv=unbase64(header.iv)
  check(salt.length===16 && iv.length===12,'保管庫の鍵形式が無効です。')
  const key=await passKey(phrase,salt)
  let raw
  try {
    raw=new Uint8Array(await crypto.subtle.decrypt({name:AES,iv,additionalData:headerAAD(header),tagLength:128},key,unbase64(header.ciphertext)))
    check(raw.length===32,'鍵の形式が無効です。')
    return await importRoot(raw)
  } catch { throw new Error('パスフレーズまたは暗号データを確認してください。') }
  finally { raw?.fill(0) }
}
async function objectKey(root,h) {
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes(h.datasetId),info:bytes('shioai:v1:'+h.objectType+':'+h.objectId)},root,{name:AES,length:256},false,['encrypt','decrypt'])
}
const aad=h=>input([h.formatVersion,h.objectType,h.datasetId,h.objectId])
export async function seal(root,datasetId,objectType,value,objectId=id()) {
  const iv=random(12),header={formatVersion:1,objectType,datasetId,objectId,iv:base64(iv)}
  const key=await objectKey(root,header)
  const cipher=await crypto.subtle.encrypt({name:AES,iv,additionalData:aad(header),tagLength:128},key,input(value))
  return {...header,ciphertext:base64(new Uint8Array(cipher))}
}
export async function open(root,datasetId,type,packet) {
  check(packet?.formatVersion===1 && packet.datasetId===datasetId && packet.objectType===type && typeof packet.objectId==='string','暗号化オブジェクトの識別子が一致しません。')
  const iv=unbase64(packet.iv)
  check(iv.length===12,'暗号化オブジェクトの IV が無効です。')
  const decrypted=await crypto.subtle.decrypt({name:AES,iv,additionalData:aad(packet),tagLength:128},await objectKey(root,packet),unbase64(packet.ciphertext))
  return parse(decrypted)
}

let connection
function database() {
  connection ??= new Promise((resolve,reject)=>{
    const request=indexedDB.open('shioai-family-os',1)
    request.onupgradeneeded=()=> {
      request.result.createObjectStore('profiles',{keyPath:'key'})
      request.result.createObjectStore('objects')
    }
    request.onsuccess=()=>resolve(request.result)
    request.onerror=()=>{connection=null;reject(request.error)}
    request.onblocked=()=>{connection=null;reject(new Error('別のタブを閉じて再試行してください。'))}
  })
  return connection
}
async function readStore(store,method,key) {
  const db=await database()
  return new Promise((resolve,reject)=>{
    const req=db.transaction(store).objectStore(store)[method](key)
    req.onsuccess=()=>resolve(req.result)
    req.onerror=()=>reject(req.error)
  })
}
export const profiles=()=>readStore('profiles','getAll')
export const profileKey=(identity,datasetId)=>(identity || 'local')+':'+datasetId
export const asset=(datasetId,objectId)=>readStore('objects','get',datasetId+':'+objectId)
export async function persist(profile,expectedStamp,objects=[],removeKey=null) {
  const db=await database()
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['profiles','objects'],'readwrite')
    const p=tx.objectStore('profiles'), a=tx.objectStore('objects')
    const q=p.get(removeKey || profile.key)
    q.onsuccess=()=>{
      if ((q.result?.stamp ?? null)!==expectedStamp) {
        tx.abort()
        return
      }
      if (removeKey && removeKey!==profile.key) p.delete(removeKey)
      p.put(profile)
      for (const item of objects) a.put(item,item.datasetId+':'+item.objectId)
    }
    tx.oncomplete=()=>resolve()
    tx.onabort=()=>reject(tx.error || new Error('別のタブで保存されました。読み込み直して再試行してください。'))
    tx.onerror=()=>reject(tx.error)
  })
}
export async function makeAsset(root,datasetId,file) {
  check(file?.size>0 && file.size<=10*1024*1024,'資料は10 MiB以内の PDF または CSV を選んでください。')
  const data=new Uint8Array(await file.arrayBuffer())
  const isPdf=/\.pdf$/i.test(file.name)
  check(isPdf || /\.csv$/i.test(file.name),'PDF または CSV を選んでください。')
  if (isPdf) check(new TextDecoder().decode(data.subarray(0,5))==='%PDF-','PDF ファイルの形式を確認してください。')
  else {
    let decoded
    try { decoded=new TextDecoder('utf-8',{fatal:true}).decode(data) }
    catch { decoded=new TextDecoder('shift_jis',{fatal:true}).decode(data) }
    check(!decoded.includes('\0') && decoded.trim(),'CSV ファイルの文字コードと内容を確認してください。')
  }
  const sha256=await hash(data)
  const packet=await seal(root,datasetId,'blob',{content:base64(data)})
  return {packet,fields:{blob_id:packet.objectId,file_name:file.name,sha256,size:data.length,document_type:isPdf?'PDF':'CSV',drive_file_id:null}}
}
export async function verifyAsset(root,datasetId,record,packet) {
  check(packet?.objectId===record.blob_id,'資料のIDが一致しません。')
  const data=unbase64((await open(root,datasetId,'blob',packet)).content)
  check(record.size===data.length && record.sha256===await hash(data),'資料のハッシュが一致しません。')
  return data
}
export const BACKUP_LIMIT=100*1024*1024
export async function createBackup(root,header,state,loadAsset,baseRef=null) {
  const datasetId=header.datasetId
  const entries=[await seal(root,datasetId,'state',orderState(validate(state)))]
  const seen=new Set()
  for (const doc of state.documents.filter(d=>d.blob_id)) {
    if (seen.has(doc.blob_id)) continue
    const packet=await loadAsset(doc)
    await verifyAsset(root,datasetId,doc,packet)
    entries.push(packet)
    seen.add(doc.blob_id)
  }
  const records=await Promise.all(entries.map(async e=>({id:e.objectId,type:e.objectType,bytes:input(e).length,sha256:await hash(input(e))})))
  const manifest=await seal(root,datasetId,'backup',{createdAt:new Date().toISOString(),baseRef,stateHash:await hash(canonical(orderState(state))),records})
  const file=new Blob([canonical({format:'shioai-backup',version:2,keyHeader:header,manifest,entries})],{type:'application/json'})
  check(file.size<=BACKUP_LIMIT,'バックアップが100 MiBの上限を超えました。')
  return file
}
export async function readBackup(file,phrase) {
  check(file?.size<=BACKUP_LIMIT,'バックアップは100 MiB以内のファイルを選んでください。')
  const data=JSON.parse(await file.text())
  check(data.format==='shioai-backup' && [1,2].includes(data.version) && Array.isArray(data.entries),'バックアップ形式を確認してください。')
  const header=data.keyHeader, root=await unlock(header,phrase), datasetId=header.datasetId
  const manifest=await open(root,datasetId,'backup',data.manifest)
  const entries=new Map(data.entries.map(e=>[e.objectId,e]))
  check(entries.size===data.entries.length && entries.size===manifest.records.length && new Set(manifest.records.map(r=>r.id)).size===entries.size,'バックアップの資料一覧が一致しません。')
  let state
  for (const r of manifest.records) {
    const e=entries.get(r.id)
    check(e?.objectType===r.type && input(e).length===r.bytes && await hash(input(e))===r.sha256,'バックアップの暗号データが一致しません。')
    if (r.type==='state') {
      check(!state,'バックアップに複数の状態があります。')
      state=validate(await open(root,datasetId,'state',e))
      entries.delete(r.id)
    } else check(r.type==='blob','未知のバックアップ形式です。')
  }
  check(state && manifest.stateHash===await hash(canonical(orderState(state))),'バックアップの状態が一致しません。')
  for (const doc of state.documents.filter(d=>d.blob_id)) await verifyAsset(root,datasetId,doc,entries.get(doc.blob_id))
  return {state,entries,root,header}
}

export async function restoreInto(backup,root,header) {
  const idMap=new Map(), objects=[]
  for (const [old,packet] of backup.entries) {
    const p=await seal(root,header.datasetId,'blob',await open(backup.root,backup.header.datasetId,'blob',packet))
    objects.push(p)
    idMap.set(old,p.objectId)
  }
  return {objects,state:{...backup.state,documents:backup.state.documents.map(d=>d.blob_id?{...d,blob_id:idMap.get(d.blob_id),drive_file_id:null}:d)}}
}
