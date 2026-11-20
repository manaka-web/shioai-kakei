import test from 'node:test'
import assert from 'node:assert/strict'
import {canonical,demoState,id,put,validate} from '../site/js/domain.js'
import {base64,newVault,open} from '../site/js/storage.js'
import {Dropbox,finishOAuth,oauthSettings,startOAuth} from '../site/js/dropbox.js'
import {VaultSession,commonBase,initialPacket,remoteProfiles} from '../site/js/sync.js'

const credentials=()=>({sub:'dropbox:samplekey1234567:dbid:test',accessToken:'test-token',expiresAt:Date.now()+3600000})
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}})
const missing=()=>json({error_summary:'path/not_found/',error:{'.tag':'path',path:{'.tag':'not_found'}}},409)

function fakeDropbox(t) {
  const files=new Map()
  const writes=[]
  const revisions=new Map()
  const credential=credentials()
  let loseReply=false
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.credentials,'omit')
    assert.equal(options.redirect,'error')
    assert.equal(options.headers.Authorization,'Bearer test-token')
    const endpoint=new URL(url).pathname
    if (endpoint==='/2/files/list_folder') return json({entries:[...files.keys()].map(path=>({'.tag':'file',path_lower:path,rev:revisions.get(path)})),cursor:'complete',has_more:false})
    const arg=JSON.parse(options.headers['Dropbox-API-Arg'])
    assert.match(arg.path,/^\/shioai-v1-[a-f0-9-]+--(blob|backup|vault|commit)--[a-f0-9-]+\.json$/)
    if (endpoint==='/2/files/download') return files.has(arg.path)?json(files.get(arg.path)):missing()
    assert.equal(endpoint,'/2/files/upload')
    assert.equal(arg.mode,'add')
    assert.equal(arg.autorename,false)
    assert.equal(arg.strict_conflict,true)
    assert.equal(options.headers['Content-Type'],'application/octet-stream')
    if (files.has(arg.path)) return json({error_summary:'path/conflict/file/'},409)
    files.set(arg.path,JSON.parse(new TextDecoder().decode(options.body)))
    revisions.set(arg.path,'rev-'+writes.length)
    writes.push(arg.path)
    if (loseReply) {loseReply=false;throw new TypeError('response lost')}
    return json({id:'dbid:object'})
  })
  return {files,writes,revisions,drive:new Dropbox(credential),credential,loseNextReply:()=>loseReply=true}
}
class Session extends VaultSession {
  async update(next,objects=[],identity=this.profile.identity) {
    this.packet=structuredClone(next)
    this.profile={...this.profile,identity}
  }
}

test('Dropbox API の追加保存は応答喪失後も同じパスで照合し、既存内容を上書きしない',async t=>{
  const server=fakeDropbox(t),dataset=id(),path=await server.drive.nextId('commit',dataset)
  const payload={formatVersion:1,datasetId:dataset,objectType:'commit',objectId:id(),iv:'AQID',ciphertext:'AQID'}
  server.loseNextReply()
  await server.drive.ensure(path,payload,'commit',dataset)
  await server.drive.ensure(path,payload,'commit',dataset)
  assert.equal(server.writes.length,1)
  await assert.rejects(server.drive.ensure(path,{...payload,ciphertext:'BAUG'},'commit',dataset),/一致しません/)
  await assert.rejects(server.drive.get('/other-folder/file.json'),/無効/)
})

test('Dropbox 一覧の全ページ、無関係ファイル、権限不足と期限切れを扱う',async t=>{
  const drive=new Dropbox(credentials()),dataset=id()
  const first=await drive.nextId('vault',dataset),second=await drive.nextId('commit',dataset)
  let calls=0
  const fetch=t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++
    if (calls===1) {
      assert.equal(JSON.parse(options.body).path,'')
      return json({entries:[{'.tag':'file',path_lower:first},{'.tag':'file',path_lower:'/notes.txt'}],cursor:'first',has_more:true})
    }
    assert.match(url,/files\/list_folder\/continue$/)
    assert.equal(JSON.parse(options.body).cursor,'first')
    return json({entries:[{'.tag':'file',path_lower:second}],cursor:'done',has_more:false})
  })
  assert.deepEqual((await drive.list()).map(x=>x.id),[first,second])
  fetch.mock.mockImplementation(async()=>json({error_summary:'missing_scope/'},403))
  await assert.rejects(drive.list(),/アクセス権限/)
  const before=fetch.mock.callCount()
  await assert.rejects(new Dropbox({...credentials(),expiresAt:0}).list(),/再接続/)
  assert.equal(fetch.mock.callCount(),before)
  fetch.mock.mockImplementation(async()=>json({error_summary:'too_many_requests/'},429,{'Retry-After':'61'}))
  await assert.rejects(drive.list(),error=>error.status===429 && error.delay===61000)
})

test('実際のDropboxアダプターでPC・iPhone分岐、統合、復旧用マニフェストを検証',async t=>{
  const server=fakeDropbox(t)
  const {root,header}=await newVault('test observatory random passphrase')
  const profile={header,identity:server.credential.sub,deviceId:'pc'}
  const a=new Session(profile,root,initialPacket(demoState()))
  await a.publish(server.drive)
  const b=new Session({...profile,deviceId:'phone'},root,structuredClone(a.packet))
  const baseline=a.packet.base
  const stateA=put(a.state,'accounts',{...a.state.accounts[0],purpose:'PC'})
  const stateB=put(b.state,'accounts',{...b.state.accounts[0],purpose:'Phone'})
  await a.prepare(server.drive,stateA,[baseline],'save')
  await b.prepare(server.drive,stateB,[baseline],'save')
  await a.send(server.drive);await b.send(server.drive)
  const graph=(await a.publish(server.drive)).graph
  assert.equal(graph.heads.length,2)
  assert.ok(commonBase(graph))
  await a.publish(server.drive,{resolution:{heads:graph.heads.map(h=>h.ref),state:stateA}})
  await b.publish(server.drive)
  assert.equal(a.packet.base.stateHash,b.packet.base.stateHash)
  assert.equal(b.state.accounts[0].purpose,'PC')
  await a.cloudBackup(server.drive,'2026-11-19')
  const backup=server.writes.find(path=>path.includes('--backup--'))
  assert.ok(backup)
  const contents=await open(root,header.datasetId,'backup',server.files.get(backup))
  assert.deepEqual(contents.ref,a.packet.base)
  const profiles=await remoteProfiles(server.drive)
  assert.equal(profiles.length,1)
  assert.equal(profiles[0].identity,server.credential.sub)
  const reads=server.files.size
  await assert.rejects(a.publish(new Dropbox({...credentials(),sub:'another-account'})),/同じ Dropbox アカウント/)
  assert.equal(reads,server.files.size)
  const prior=server.files.get(a.packet.base.driveFileId)
  server.files.set(a.packet.base.driveFileId,{...prior,ciphertext:'AQID'})
  server.revisions.set(a.packet.base.driveFileId,'external-change')
  await assert.rejects(a.graph(server.drive))
  server.files.set(a.packet.base.driveFileId,prior)
  server.revisions.set(a.packet.base.driveFileId,'restored')
  server.files.delete(a.packet.base.driveFileId)
  await assert.rejects(a.graph(server.drive),/見つかりません/)
})

test('Dropbox PKCE認証はS256、state、期限、アカウントとscopeを検証する',async t=>{
  // Browser globals are temporary properties so credentials never reach disk.
  const globals=['location','sessionStorage','history']
  for (const key of globals) {
    const previous=Object.getOwnPropertyDescriptor(globalThis,key)
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:undefined})
    t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key])
  }
  const memory=new Map(),location={origin:'https://example.github.io',pathname:'/kakei/oauth/callback.html',search:'',assign(url){this.assigned=url}}
  globalThis.location=location
  globalThis.sessionStorage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k),removeItem:k=>memory.delete(k)}
  globalThis.history={replaceState(_,__,path){location.search='';location.pathname=path}}
  const redirect=location.origin+location.pathname
  await startOAuth('samplekey1234567',redirect)
  const authorize=new URL(location.assigned),pending=JSON.parse(memory.values().next().value)
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256')
  assert.equal(authorize.searchParams.get('token_access_type'),'online')
  assert.equal(authorize.searchParams.has('client_secret'),false)
  const expected=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pending.verifier))))
  assert.equal(authorize.searchParams.get('code_challenge'),expected)
  location.search='?code=test-code&state='+pending.state
  let exchanges=0
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    exchanges++
    if (url.endsWith('/oauth2/token')) {
      assert.equal(options.body.get('code_verifier'),pending.verifier)
      assert.equal(options.body.get('client_id'),'samplekey1234567')
      assert.equal(options.body.has('client_secret'),false)
      return json({access_token:'test-token',token_type:'bearer',expires_in:14400,account_id:'dbid:test',scope:authorize.searchParams.get('scope')})
    }
    assert.match(url,/users\/get_current_account$/)
    return json({account_id:'dbid:test',name:{display_name:'Test'}})
  })
  const credential=await finishOAuth()
  assert.equal(credential.sub,'dropbox:samplekey1234567:dbid:test')
  assert.equal(memory.size,0)
  assert.equal(location.search,'')
  assert.ok(!canonical([...memory]).includes(credential.accessToken))
  memory.set('shioai-dropbox-oauth-v1',JSON.stringify(pending))
  location.search='?code=x&state=incorrect'
  await assert.rejects(finishOAuth(),/期限が切れたか/)
  assert.equal(exchanges,2)
  memory.set('shioai-dropbox-oauth-v1',JSON.stringify({...pending,expiresAt:Date.now()-1}))
  location.search='?code=x&state='+pending.state
  await assert.rejects(finishOAuth(),/期限が切れたか/)
  assert.throws(()=>oauthSettings('samplekey1234567','http://example.com/callback'),/HTTPS/)
})
