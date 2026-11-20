import {bytes,canonical,check,id} from './domain.js'
import {base64} from './storage.js'

const RPC='https://api.dropboxapi.com/2/'
const CONTENT='https://content.dropboxapi.com/2/'
const TOKEN='https://api.dropboxapi.com/oauth2/token'
const PENDING='shioai-dropbox-oauth-v1'
const SCOPES=['account_info.read','files.metadata.read','files.content.read','files.content.write']
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATH=new RegExp('^/shioai-v1-('+UUID+')--(vault|commit|blob|backup)--('+UUID+')\\.json$')
export const callbackUrl=()=>new URL('../oauth/callback.html',import.meta.url).href

export function oauthSettings(appKey,redirectUri) {
  check(typeof appKey==='string' && /^[A-Za-z0-9]{8,100}$/.test(appKey),'Dropbox の App key を設定してください。')
  const redirect=new URL(redirectUri)
  check(redirect.protocol==='https:' || (redirect.protocol==='http:' && ['127.0.0.1','localhost'].includes(redirect.hostname)),'HTTPS の公開URL、またはこの端末のローカルURLで接続してください。')
  check(!redirect.search && !redirect.hash,'認証の戻り先URLを確認してください。')
  return {appKey,redirectUri:redirect.href}
}
export async function startOAuth(appKey,redirectUri=callbackUrl()) {
  const settings=oauthSettings(appKey,redirectUri)
  const verifier=base64(crypto.getRandomValues(new Uint8Array(32)))
  const challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(verifier))))
  const state=base64(crypto.getRandomValues(new Uint8Array(32)))
  const pending={...settings,verifier,state,expiresAt:Date.now()+10*60*1000}
  sessionStorage.setItem(PENDING,JSON.stringify(pending))
  const params=new URLSearchParams({client_id:appKey,redirect_uri:settings.redirectUri,response_type:'code',code_challenge_method:'S256',code_challenge:challenge,state,token_access_type:'online',scope:SCOPES.join(' ')})
  location.assign('https://www.dropbox.com/oauth2/authorize?'+params)
}
export async function finishOAuth() {
  const query=new URLSearchParams(location.search)
  if (!query.has('code') && !query.has('error')) return null
  const raw=sessionStorage.getItem(PENDING)
  history.replaceState(null,'',location.pathname)
  sessionStorage.removeItem(PENDING)
  check(!query.has('error'),'Dropbox 接続が中断されました。もう一度接続してください。')
  let pending
  try { pending=JSON.parse(raw || 'null') } catch { pending=null }
  check(pending && pending.state===query.get('state') && pending.expiresAt>Date.now(),'認証の期限が切れたか、戻り先が一致しません。もう一度 Dropbox に接続してください。')
  oauthSettings(pending.appKey,pending.redirectUri)
  check(new URL(pending.redirectUri).href===new URL(location.pathname,location.origin).href,'認証の戻り先URLが一致しません。')
  const params=new URLSearchParams({grant_type:'authorization_code',code:query.get('code'),client_id:pending.appKey,redirect_uri:pending.redirectUri,code_verifier:pending.verifier})
  const response=await fetch(TOKEN,{method:'POST',body:params,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)})
  check(response.ok,'Dropbox の認証を完了できません。App key と戻り先URLを確認して再接続してください。')
  const token=await response.json()
  check(typeof token.access_token==='string' && token.token_type?.toLowerCase()==='bearer' && Number.isFinite(token.expires_in) && token.expires_in>10,'Dropbox の認証情報を確認できません。')
  const granted=new Set(String(token.scope || '').split(' '))
  check(SCOPES.every(s=>granted.has(s)),'Dropbox の Permissions に必要な4つの権限を設定して再接続してください。')
  const credential={accessToken:token.access_token,expiresAt:Date.now()+token.expires_in*1000,appKey:pending.appKey}
  const account=await (await new Dropbox(credential).rpc('users/get_current_account',null)).json()
  check(typeof account.account_id==='string' && account.account_id.startsWith('dbid:') && account.account_id===token.account_id,'Dropbox のアカウントを確認できません。')
  return {...credential,sub:'dropbox:'+pending.appKey+':'+account.account_id,accountLabel:account.name?.display_name || 'Dropbox'}
}

export class DropboxError extends Error {
  constructor(status,body,retryAfter) {
    const summary=String(body?.error_summary || '')
    const missing=status===409 && /^path\/not_found\//.test(summary)
    const tag=body?.error?.['.tag']
    const message=status===401?'Dropbox に再接続してください。':
      status===403?'Dropbox のアクセス権限を確認してください。':
      status===429?'Dropbox の利用制限に達しました。時間をおいて同期してください。':
      status===507 || tag==='insufficient_space'?'Dropbox の空き容量を確認してください。':
      missing?'Dropbox のファイルが見つかりません。':
      status===409?'Dropbox の保存先が競合しました。同期を再試行してください。':
      'Dropbox との通信を確認できません（'+status+'）。'
    super(message)
    this.status=missing?404:status
    this.retry=status===429 || status>=500 && status!==507
    this.delay=/^\d+$/.test(retryAfter || '')?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-Date.now()) || 0
  }
}

export class Dropbox {
  constructor(credential){this.credential=credential}
  async request(url,options={},retry=true) {
    check(this.credential.expiresAt>Date.now()+10000,'Dropbox に再接続してください。')
    for (let attempt=0;;attempt++) {
      let fault
      try {
        const response=await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+this.credential.accessToken},cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(35000)})
        if (response.ok) return response
        fault=new DropboxError(response.status,await response.json().catch(()=>({})),response.headers.get('Retry-After'))
      } catch(error) {fault=error}
      if (!retry || attempt>=3 || fault instanceof DropboxError && !fault.retry) throw fault
      const delay=Math.max(fault.delay || 0,500*2**attempt+Math.random()*500)
      // Long Retry-After values are retried by the next foreground sync.
      if (delay>30000) throw fault
      await new Promise(resolve=>setTimeout(resolve,delay))
    }
  }
  rpc(method,value) {
    return this.request(RPC+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})
  }
  async list() {
    const out=new Map(),cursors=new Set()
    let response=await this.rpc('files/list_folder',{path:'',recursive:false,include_deleted:false,limit:2000})
    for (;;) {
      const page=await response.json()
      check(Array.isArray(page.entries) && typeof page.has_more==='boolean' && typeof page.cursor==='string','Dropbox の一覧を完全に取得できません。')
      for (const entry of page.entries) {
        const match=PATH.exec(entry.path_lower || '')
        if (!match) continue
        if (entry['.tag']==='deleted') {out.delete(entry.path_lower);continue}
        check(entry['.tag']==='file','Dropbox の保存先にフォルダがあります。')
        out.set(entry.path_lower,{id:entry.path_lower,revision:entry.rev,appProperties:{dataset:match[1],kind:match[2]}})
      }
      if (!page.has_more) return [...out.values()]
      check(!cursors.has(page.cursor),'Dropbox の一覧取得が繰り返されました。再試行してください。')
      cursors.add(page.cursor)
      response=await this.rpc('files/list_folder/continue',{cursor:page.cursor})
    }
  }
  async nextId(kind,datasetId) {
    check(['vault','commit','blob','backup'].includes(kind),'Dropbox のファイル種別が不明です。')
    const path='/shioai-v1-'+datasetId+'--'+kind+'--'+id()+'.json'
    check(PATH.test(path),'Dropbox の保管庫IDが不明です。')
    return path
  }
  async get(fileId) {
    check(PATH.test(fileId),'Dropbox のファイル参照が無効です。')
    const response=await this.request(CONTENT+'files/download',{method:'POST',headers:{'Dropbox-API-Arg':JSON.stringify({path:fileId})}})
    return response.json()
  }
  async ensure(fileId,payload,kind,datasetId) {
    const match=PATH.exec(fileId)
    check(match && match[1]===datasetId && match[2]===kind,'Dropbox の送信先が一致しません。')
    const text=canonical(payload)
    check(bytes(text).length<100*1024*1024,'Dropbox の送信上限を超えました。')
    const verify=async()=>{
      try {
        const existing=await this.get(fileId)
        check(canonical(existing)===text,'予約した保存先と内容が一致しません。別の版を上書きできません。')
        return true
      } catch(error) {if(error.status===404) return false;throw error}
    }
    if (await verify()) return
    try {
      await this.request(CONTENT+'files/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:fileId,mode:'add',autorename:false,strict_conflict:true,mute:true})},body:bytes(text)},false)
    } catch(error) {
      if (await verify()) return
      throw error
    }
    check(await verify(),'Dropbox の送信結果を確認できません。同じ保存を再試行してください。')
  }
}
