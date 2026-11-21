import test from 'node:test'
import assert from 'node:assert/strict'
import {canonical,demoState,id} from '../site/js/domain.js'
import {createBackup,newVault,open,readBackup,seal,unlock} from '../site/js/storage.js'
import {Dropbox,rememberedConnection} from '../site/js/dropbox.js'
import {VaultSession,initialPacket} from '../site/js/sync.js'
import {lockDue,preferences,savePreferences} from '../site/js/preferences.js'

const saved=()=>({sub:'dropbox:samplekey1234567:dbid:test',appKey:'samplekey1234567',refreshToken:'sensitive-refresh-token',accountLabel:'My account'})
const credential=()=>({...saved(),accessToken:'expired-token',expiresAt:0})
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
const renewed=()=>({access_token:'renewed-token',token_type:'bearer',expires_in:14400})
const account=()=>({account_id:'dbid:test',name:{display_name:'Test user'}})

test('接続期限が切れた複数の処理を一度の更新で再開し、更新情報をURLに含めない',async t=>{
  let exchanges=0,accounts=0,lists=0
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.credentials,'omit')
    assert.equal(options.redirect,'error')
    assert.equal(url.includes('sensitive-refresh-token'),false)
    if (url.endsWith('/oauth2/token')) {
      exchanges++
      assert.equal(options.body.get('grant_type'),'refresh_token')
      assert.equal(options.body.get('client_id'),'samplekey1234567')
      assert.equal(options.body.get('refresh_token'),'sensitive-refresh-token')
      assert.equal(options.body.has('client_secret'),false)
      return json(renewed())
    }
    assert.equal(options.headers.Authorization,'Bearer renewed-token')
    if (url.endsWith('/users/get_current_account')) {accounts++;return json(account())}
    lists++
    return json({entries:[],has_more:false,cursor:'done'})
  })
  const client=new Dropbox(credential())
  await Promise.all([client.list(),client.list(),client.list()])
  assert.deepEqual([exchanges,accounts,lists],[1,1,3])
  assert.equal(client.credential.refreshToken,saved().refreshToken)
  assert.ok(client.credential.expiresAt>Date.now())
})

test('期限内でも401なら一度更新し、アカウントが変わればファイルへアクセスしない',async t=>{
  let renewals=0,lists=0
  const mock=t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/oauth2/token')) {renewals++;return json(renewed())}
    if(url.endsWith('/users/get_current_account')) return json(account())
    lists++
    return lists===1?json({error_summary:'expired_access_token/'},401):json({entries:[],has_more:false,cursor:'done'})
  })
  const client=new Dropbox({...credential(),expiresAt:Date.now()+3600000})
  await client.list()
  assert.equal(renewals,1)
  assert.equal(lists,2)
  mock.mock.mockImplementation(async url=>{
    if(url.endsWith('/oauth2/token')) return json(renewed())
    if(url.endsWith('/users/get_current_account')) return json({account_id:'dbid:other'})
    assert.fail('File request after account mismatch')
  })
  await assert.rejects(new Dropbox(credential()).list(),e=>e.code==='reconnect_required')
})

test('許可取消しは再接続を案内し、通信障害は次の更新で再試行できる',async t=>{
  let calls=0
  const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return json({error:'invalid_grant'},400)})
  const revoked=new Dropbox(credential())
  await assert.rejects(revoked.list(),e=>e.code==='reconnect_required')
  await assert.rejects(revoked.list(),e=>e.code==='reconnect_required')
  assert.equal(calls,1)
  mock.mock.mockImplementation(async()=>{throw new TypeError('offline')})
  const recovering=new Dropbox(credential())
  await assert.rejects(recovering.ready(),/offline/)
  assert.equal(recovering.credential.refreshToken,saved().refreshToken)
  mock.mock.mockImplementation(async url=>json(url.endsWith('/oauth2/token')?renewed():account()))
  await recovering.ready()
  assert.equal(recovering.credential.accessToken,'renewed-token')
})

test('接続更新中にロックしたら、更新結果と接続情報を利用しない',async t=>{
  let release,remembered=false
  const pending=new Promise(resolve=>release=resolve)
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/oauth2/token')) {await pending;return json({...renewed(),refresh_token:'rotated-token'})}
    return json(account())
  })
  const client=new Dropbox(credential(),{onRefresh:async()=>remembered=true})
  const task=client.ready()
  client.dispose()
  release()
  await assert.rejects(task,/ロック/)
  assert.equal(remembered,false)
  assert.equal(client.credential.refreshToken,null)
  assert.equal(client.credential.accessToken,'')
})

test('ローテーション後の接続情報を暗号化保存してから処理を再開する',async t=>{
  let persisted=false
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/oauth2/token')) return json({...renewed(),refresh_token:'rotated-token'})
    if(url.endsWith('/users/get_current_account')) return json(account())
    assert.equal(persisted,true)
    return json({entries:[],has_more:false,cursor:'done'})
  })
  const client=new Dropbox(credential(),{onRefresh:async next=>{
    assert.equal(next.refreshToken,'rotated-token')
    assert.equal(next.accessToken,undefined)
    persisted=true
  }})
  await client.list()
  assert.equal(persisted,true)
})

class EncryptedSession extends VaultSession {
  async update(next) {
    this.profile={...this.profile,packet:await seal(this.root,this.dataset,'local',next)}
    this.packet=next
  }
}

test('再起動時の接続情報は保管庫解除で復元され、家計の版やバックアップに混ざらない',async()=>{
  const password='test random words for encrypted vault'
  const {header,root}=await newVault(password)
  const state=demoState()
  const session=new EncryptedSession({header,identity:saved().sub,deviceId:id()},root,initialPacket(state))
  await session.rememberConnection(rememberedConnection(credential()))
  const stored=structuredClone(session.profile)
  assert.equal(JSON.stringify(stored).includes(saved().refreshToken),false)
  const reopened=await VaultSession.existing(stored,await unlock(header,password))
  assert.deepEqual(reopened.packet.connection,saved())
  assert.equal(Object.hasOwn(reopened.packet.connection,'accessToken'),false)
  const backup=await createBackup(root,header,state,()=>assert.fail('No attachments'))
  const restored=await readBackup(backup,password)
  assert.equal(canonical(restored.state).includes(saved().refreshToken),false)
  let uploaded
  const localCloud={
    credential:{sub:saved().sub},
    nextId:async()=>id(),
    ensure:async(fileId,payload,kind)=>{if(kind==='commit') uploaded=payload},
    list:async()=>[],
  }
  await session.prepare(localCloud,state,[],'save')
  await session.send(localCloud)
  const commit=await open(root,header.datasetId,'commit',uploaded)
  assert.equal(canonical(commit).includes(saved().refreshToken),false)
  await session.forgetConnection()
  assert.equal(session.packet.connection,null)
  await assert.rejects(session.rememberConnection({...saved(),sub:'dropbox:samplekey1234567:dbid:other'}),/一致しません/)
})

test('旧設定を10分で開き、時間変更・自動ロックなし・再読み込みを反映する',()=>{
  const memory=new Map(),storage={getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)}
  assert.deepEqual(preferences(storage),{autoLockMinutes:10,rememberDropbox:true})
  savePreferences({autoLockMinutes:30,rememberDropbox:true},storage)
  assert.equal(preferences(storage).autoLockMinutes,30)
  assert.equal(lockDue(30,0,29*60000),false)
  assert.equal(lockDue(30,0,30*60000),true)
  assert.equal(lockDue(30,29*60000,30*60000),false)
  savePreferences({autoLockMinutes:0,rememberDropbox:false},storage)
  assert.equal(lockDue(preferences(storage).autoLockMinutes,0,48*3600000),false)
  assert.throws(()=>savePreferences({autoLockMinutes:17,rememberDropbox:true},storage))
})
