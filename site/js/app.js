import {SCHEMA,active,billKey,canonical,check,control,demoState,emptyState,fold,id,importLegacy,labels,makeClosing,mergeStates,now,put,today,validate,yen} from './domain.js'
import {createBackup,makeAsset,newVault,profileKey,profiles,readBackup,restoreInto,unlock,verifyAsset} from './storage.js'
import {VaultSession,commonBase,initialPacket,remoteProfiles} from './sync.js'
import {Dropbox,callbackUrl,finishOAuth,oauthSettings,rememberedConnection,startOAuth} from './dropbox.js'
import {LOCK_OPTIONS,lockDue,lockLabel,preferences,savePreferences} from './preferences.js'
import {config} from './config.js'
import {badge,billsView,button,docsView,drawCharts,empty,esc,homeView,icon,labelDate,names,note,observationsView,reportsView,section,shell,sortedAccounts,table} from './view.js'

const app=document.querySelector('#app'),modal=document.querySelector('#modal'),toast=document.querySelector('#toast')
const compass=new URL('../assets/compass.svg',import.meta.url).href
const startPage=new URL('../index.html',import.meta.url)
const KEY_SETTING='shioai-dropbox-app-key'
const appKey=()=>localStorage.getItem(KEY_SETTING) || config.dropboxAppKey || ''
const bus=typeof BroadcastChannel==='function'?new BroadcastChannel('shioai-family-os'):null
let session=null, credential=null, drive=null, locals=[], remotes=[], demo=demoState(), mode='demo', range='6'
let syncing=false, conflict=null, alertText='', lastActive=Date.now(), lastPoll=0, noticeTimer, submitHandler, queuedSync
const stateNow=()=>session?.state || demo
const routeNow=()=> Object.hasOwn(names,location.hash.slice(1)) ? location.hash.slice(1) : 'home'
const validDropbox=()=>Boolean(credential && drive && !drive.disposed && !drive.reconnectRequired && credential.expiresAt>Date.now()+10000)
const resumableDropbox=()=>Boolean(credential && drive && !drive.disposed && !drive.reconnectRequired && (validDropbox() || credential.refreshToken))
const available=()=>resumableDropbox() && navigator.onLine
const notify=text=>{
  clearTimeout(noticeTimer)
  toast.textContent=text
  noticeTimer=setTimeout(()=>toast.textContent='',3500)
}
function clientFor(value) {
  return new Dropbox(value,{onRefresh:async remembered=>{
    if (session?.profile.identity===remembered.sub && preferences().rememberDropbox) await session.rememberConnection(remembered)
  }})
}
async function resumeConnection(vault) {
  if (!vault.profile.identity) return
  if (credential?.sub!==vault.profile.identity) {
    drive?.dispose()
    drive=null;credential=null;remotes=[]
    const saved=preferences().rememberDropbox?vault.packet.connection:null
    if (!saved) return
    check(saved.sub===vault.profile.identity,'保管庫と接続先のアカウントが一致しません。')
    if (appKey() && saved.appKey!==appKey()) {
      alertText='App key が変更されています。接続設定を確認してください。'
      return
    }
    if (!appKey()) localStorage.setItem(KEY_SETTING,saved.appKey)
    credential={...saved,accessToken:'',expiresAt:0}
    drive=clientFor(credential)
  }
  if (!drive) drive=clientFor(credential)
  if (preferences().rememberDropbox && credential.refreshToken) await vault.rememberConnection(rememberedConnection(credential))
  if (navigator.onLine) {
    try { await drive.ready() }
    catch(error) {alertText=error.message;notify(error.message)}
  }
}
const get=(table,key,value)=>stateNow()[table].find(row=>row[key]===value)
const badgeStatus=()=>{
  if (mode==='demo') return {kind:'demo',text:'サンプルデータ'}
  if (mode==='locked') return {kind:'warning',text:'ロック中'}
  if (conflict) return {kind:'warning',text:'競合あり'}
  if (syncing) return {kind:'warning',text:'同期中'}
  if (session.profile.identity && !navigator.onLine) return {kind:'warning',text:'オフライン'}
  if (session.profile.identity && !validDropbox()) return {kind:'warning',text:resumableDropbox()?'Dropbox 自動接続待ち':'Dropbox 再接続が必要'}
  if (session.profile.identity && (session.dirty || session.packet.pending)) return {kind:'warning',text:'端末に保存 · 未同期'}
  if (session.profile.identity && session.packet.syncedAt) return {kind:'ok',text:'Dropbox 保存確認 '+new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(session.packet.syncedAt))}
  return {kind:'ok',text:'端末に暗号化保存'}
}
function profileRow(p,i,action='unlock') {
  return button((p.identity?'Dropbox':'この端末')+' · '+p.header.datasetId.slice(0,8),action,{target:String(i),symbol:'lock'})
}
function lockedView(route) {
  return (route==='settings'?settingsView():'<section class="locked"><div class="locked-inner"><img src="'+compass+'" alt=""><h2>保管庫を解除</h2><p>パスフレーズで、保存した観測を開きます。</p>'+locals.map((p,i)=>profileRow(p,i)).join('')+remotes.filter(p=>!locals.some(l=>l.key===p.key)).map((p,i)=>button('Dropbox の保管庫 · '+p.header.datasetId.slice(0,8),'remote-unlock',{target:p.key})).join('')+button('設定へ','settings')+'</div></section>')
}
function settingsView() {
  const mobile='<div class="subnav"><a href="#reports">レポート</a><a href="#settings" aria-current="page">設定</a></div>'
  const card=(title,text,actions)=>'<section class="panel content-panel"><h3>'+title+'</h3><p>'+esc(text)+'</p>'+actions+'</section>'
  const vaultButtons=locals.map((p,i)=>p.key===session?.profile.key?'':profileRow(p,i)).join('')
  const remoteButtons=remotes.filter(p=>!locals.some(l=>l.key===p.key)).map(p=>button('Dropbox · '+p.header.datasetId.slice(0,8),'remote-unlock',{target:p.key,symbol:'lock'})).join('')
  const pref=preferences()
  const vault=card('保管庫',session?'開いている保管庫 '+session.dataset.slice(0,8)+' · '+(pref.autoLockMinutes?lockLabel(pref.autoLockMinutes)+'で自動ロック':lockLabel(0)):mode==='demo'?'サンプルの編集はこの画面内だけに保存されます。実際のデータ用には保管庫を作成してください。':'保管庫を選び、パスフレーズで解除します。',button('空の保管庫を作成','new',{variant:session?'secondary':'primary',symbol:'plus'})+(session?button('ロック','lock',{symbol:'lock'}):button('サンプルを開く','demo'))+vaultButtons+remoteButtons)
  const cloud=card('Dropbox 同期',validDropbox()?'Dropbox に接続済み · '+credential.accountLabel:resumableDropbox()?'自動接続を再試行できます。「今すぐ同期」を選んでください。':appKey()?'同じ Dropbox アカウントで接続して、保管庫を選びます。':'最初に Dropbox の App key を登録してください。',
    button(appKey()?'接続設定を確認':'App key を登録','connection-settings')+(appKey()?button(validDropbox()?'Dropbox に再接続':'Dropbox に接続','connect',{symbol:'sync'}):'')+
    (available() && session ? session.profile.identity===credential.sub ? button('今すぐ同期','sync',{variant:'primary',symbol:'sync'}) : !session.profile.identity?button('この保管庫を Dropbox に接続','bind',{variant:'primary'}):'' : '')+
    (validDropbox()?button('Dropbox の保管庫を探す','discover'):'')+
    (validDropbox() || session?.packet.connection?button('この保管庫の接続を解除','disconnect'):'')+(conflict?button('競合を確認','resolve',{variant:'primary'}):''))
  const behavior=card('自動ロック・接続の記憶',(pref.autoLockMinutes?'操作がない状態で'+lockLabel(pref.autoLockMinutes)+'後にロック。':'自動ロックなし。')+(pref.rememberDropbox?'この端末では、保管庫の解除後に Dropbox へ自動接続します。':'Dropbox へは手動で接続します。'),button('使い方を設定','preferences'))
  const migration=card('旧シートから移行','読み取り専用で取得したスナップショットを選ぶと、7タブの件数と検証結果を確認できます。',session?button('移行ファイルを検証','migration'):button('空の保管庫を作成','new'))
  const backups=card('バックアップと復元','バックアップはパスフレーズで保護されます。別の端末や保管庫でも復元できます。', (session?button('暗号化バックアップを保存','backup'):'' )+button('バックアップを復元','restore')+(session?.packet.retainedDraft?button('競合前の下書きを保存','retained'):''))
  return section('設定','接続、移行、データの保全。 · v1.2')+mobile+(alertText?note(alertText,true):'')+'<div class="settings-grid">'+vault+cloud+behavior+migration+backups+'</div>'
}
function render() {
  const route=routeNow()
  const state=conflict ? conflict.common?.state || emptyState() : stateNow()
  const view=({home:()=>homeView(state,range),observations:()=>observationsView(state),bills:()=>billsView(state),documents:()=>docsView(state),reports:()=>reportsView(state,range),settings:settingsView})[route]
  const banner=conflict && route!=='settings' ? '<div class="notice warning">競合が見つかりました。確定済みの共通状態を表示しています。 '+button('差分を確認','resolve',{variant:'ghost'})+'</div>' : ''
  const offline=mode==='open' && !navigator.onLine && route!=='settings' ? note('オフライン。変更は端末に下書き保存できます。') : ''
  app.innerHTML=shell(route,badgeStatus(),mode==='locked'?lockedView(route):banner+offline+view(),state.home[0]?.home_title && mode==='open' && state.home[0].home_title!=='しおあい家計OS'?state.home[0].home_title:'')
  document.title=names[route]+' · しおあい家計OS'
  requestAnimationFrame(()=>drawCharts(state,range))
}
function go(route) {
  if (routeNow()===route && location.hash) render()
  else location.hash=route
}
async function loadProfiles() {
  locals=(await profiles()).filter(p=>!p.identity || p.identity.startsWith('dropbox:'))
  if (mode==='demo' && session) mode='open'
}
function clearVault({showDemo=false}={}) {
  modal.close()
  // The encrypted connection stays on disk. Live credentials leave memory.
  drive?.dispose()
  credential=null;drive=null;remotes=[];queuedSync=null
  session=null; conflict=null; syncing=false; submitHandler=null
  mode=showDemo?'demo':'locked'
  render()
}
async function createLocal(header,root,working=emptyState(),objects=[]) {
  check(!syncing,'同期が終わってから保管庫を切り替えてください。')
  const profile={header,identity:null,key:profileKey(null,header.datasetId),deviceId:id(),stamp:null}
  const next=new VaultSession(profile,root,initialPacket(working))
  await next.update(next.packet,objects)
  session=next; mode='open'; conflict=null
  await loadProfiles()
  render()
}
function ensureEdit() {
  check(mode!=='locked','保管庫を解除してください。')
  check(!syncing,'同期が完了してから操作してください。')
  check(!conflict,'先に保存の競合を解決してください。')
}
async function save(state,{objects=[],reason='save',message='端末に保存しました。',upload=true}={}) {
  ensureEdit()
  validate(state)
  if (!session) {
    demo=state; render(); notify('サンプルに反映しました。')
    return
  }
  await session.stage(state,objects,reason)
  bus?.postMessage(session.profile.key)
  render()
  notify(message)
  if (upload && available() && session.profile.identity===credential.sub) {
    if (modal.open) queuedSync={reason,session}
    else void sync(reason)
  }
}
async function sync(reason='save',resolution=null, expected=session) {
  if (!expected || expected!==session || syncing || !available() || expected.profile.identity!==credential.sub) return
  if (modal.open && !resolution) {
    // A draft entered in a dialog should have a stable starting point.
    lastPoll=0
    return
  }
  syncing=true; lastPoll=Date.now(); alertText=''; render()
  const run=async()=>{
    if (resolution && expected.dirty) await expected.update({...expected.packet,retainedDraft:expected.state})
    await drive.ready()
    const result=await expected.publish(drive,{reason,resolution})
    if (expected!==session) return
    conflict=null
    if (result.conflict) conflict={...result.conflict,...result,common:{state:expected.packet.baseState}}
    else if (result.graph.heads.length>1) conflict={...result,common:commonBase(result.graph)}
    if (conflict) notify('保存の競合があります。差分を確認してください。')
    else {
      try { await expected.cloudBackup(drive,today()) }
      catch { alertText='Dropbox へのバックアップを確認できません。次の同期で再試行します。' }
    }
    bus?.postMessage(expected.profile.key)
  }
  try {
    if (navigator.locks?.request) await navigator.locks.request('shioai:'+expected.profile.key,{ifAvailable:true},lock=>lock?run():null)
    else await run()
  } catch(error) { alertText=error.message || 'Dropbox 同期を完了できませんでした。'; notify(alertText) }
  finally { if (expected===session) {syncing=false;render()} }
}
async function discover() {
  check(available(),'Dropbox に再接続してください。')
  await drive.ready()
  remotes=await remoteProfiles(drive)
  render()
  notify(remotes.length?'Dropbox の保管庫を読み込みました。':'この Dropbox アカウントに保管庫はありません。')
}
function download(blob,filename) {
  const url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url; a.download=filename; document.body.append(a); a.click(); a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),15000)
}
async function exportState(state) {
  check(session,'バックアップする保管庫を解除してください。')
  const snapshot=session
  const file=await createBackup(snapshot.root,snapshot.profile.header,state,d=>snapshot.document(available() && snapshot.profile.identity===credential.sub?drive:null,d),snapshot.packet.base)
  check(snapshot===session,'保管庫がロックされました。')
  download(file,'shioai-'+today()+'.shioai')
}
function dialog(title,body,submit=null,{label='保存する',description='',aux=''}={}) {
  submitHandler=submit
  modal.innerHTML='<div class="dialog-head"><h2 id="dialog-title">'+esc(title)+'</h2><button type="button" data-action="close" class="button ghost" aria-label="閉じる">'+icon('cross')+'</button></div><form class="dialog-body">'+(description?'<p>'+esc(description)+'</p>':'')+body+'<p class="error" role="alert"></p><div class="form-foot">'+aux+button(submit?'キャンセル':'閉じる','close',{variant:'ghost'})+(submit?'<button class="button primary" type="submit">'+esc(label)+'</button>':'')+'</div></form>'
  if (!modal.open) modal.showModal()
}
const attr=(key,v)=>v==null?'':' '+key+'="'+esc(v)+'"'
function field(label,name,value='',options={}) {
  const {type='text',wide=false,required=false,placeholder,max,min,accept,opts,step,autocomplete,maxlength}=options
  const base=' name="'+esc(name)+'"'+(required?' required':'')
  const optionTags=opts?.map(([v,l])=>'<option value="'+esc(v)+'"'+(String(value)===String(v)?' selected':'')+'>'+esc(l)+'</option>').join('')
  const input=type==='checkbox'?'<input type="checkbox"'+base+(value?' checked':'')+'>':type==='textarea'?'<textarea'+base+attr('maxlength',maxlength ?? 3000)+'>'+esc(value)+'</textarea>':opts?'<select'+base+'>'+optionTags+'</select>':'<input type="'+type+'"'+base+(type==='file'?'':attr('value',value))+attr('placeholder',placeholder)+attr('max',max)+attr('min',min)+attr('accept',accept)+attr('step',step)+attr('autocomplete',autocomplete)+attr('maxlength',maxlength)+'>'
  return '<label class="field'+(wide?' full':'')+(type==='checkbox'?' check':'')+'">'+(type==='checkbox'?input+esc(label):esc(label)+input)+'</label>'
}
const fields=(...items)=>'<div class="form-grid">'+items.join('')+'</div>'
const optional=(data,k)=>String(data.get(k) ?? '').trim() || null
const int=(data,k)=>optional(data,k)==null?null:Number(data.get(k))
const choose=(label,name,rows,value='',required=true)=>field(label,name,value,{opts:[['','選択してください'],...rows],required})
const noteField=(value,label='メモ')=>field(label,'note',value,{type:'textarea',wide:true})
const aOptions=(filter,opt=null)=>sortedAccounts(stateNow()).filter(a=>filter(a) || a.account_id===opt).map(a=>[a.account_id,a.account_name+(a.is_active?'':'（無効）')])
const cOptions=(opt=null)=>active(stateNow().cards).filter(c=>c.is_active || c.card_id===opt).map(c=>[c.card_id,c.card_name])
const docOptions=()=>active(stateNow().bills).map(b=>[b.bill_id,(get('cards','card_id',b.card_id)?.card_name || '')+' '+b.statement_month+' '+yen(b.amount_jpy)])
function deleted(table,key,row) {
  return row?button('削除','delete',{target:JSON.stringify([table,key,row[key]]),variant:'ghost'}):''
}
function accountDialog(value) {
  ensureEdit()
  const row=get('accounts','account_id',value)
  dialog(row?'口座を編集':'口座を追加',fields(
    field('口座名','account_name',row?.account_name,{required:true,maxlength:100}),field('金融機関・サービス','institution_name',row?.institution_name,{maxlength:100}),
    field('種類','account_type',row?.account_type || 'Bank',{opts:[['Bank','銀行'],['EWallet','電子マネー']]}),field('残高の区分','balance_category',row?.balance_category || 'Ordinary',{opts:[['Ordinary','普通預金'],['Term','定期預金'],['EWallet','電子マネー']]}),
    field('用途','purpose',row?.purpose,{maxlength:160}),field('表示順','sort_order',row?.sort_order,{type:'number',step:1}),
    field('集計に含める','include_total',row?.include_total ?? true,{type:'checkbox'}),field('有効','is_active',row?.is_active ?? true,{type:'checkbox'}),
    field('カード引落に使う','can_card_debit',row?.can_card_debit ?? false,{type:'checkbox'}),noteField(row?.memo)
  ),async data=>{
    const next={...row,account_name:optional(data,'account_name'),institution_name:optional(data,'institution_name'),account_type:data.get('account_type'),balance_category:data.get('balance_category'),purpose:optional(data,'purpose'),sort_order:int(data,'sort_order'),include_total:data.has('include_total'),is_active:data.has('is_active'),can_card_debit:data.has('can_card_debit'),memo:optional(data,'note')}
    await save(put(stateNow(),'accounts',next))
  })
}
function observationDialog(value,accountId='') {
  ensureEdit()
  const row=get('observations','observation_id',value)
  const options=aOptions(a=>a.is_active,row?.account_id)
  check(options.length,'先に観測点で口座を追加してください。')
  const multiple=!row && !accountId && options.length>1
  dialog(row?'観測を編集':'今回の観測を記録',fields(
    field('観測日','observed_on',row?.observed_on || today(),{type:'date',required:true,max:today(),wide:multiple}),
    ...(multiple?options.map(([key,name],i)=>field(name+'（円）','amount-'+i,'',{type:'number',step:1,placeholder:'未入力は記録しない'})):[
      choose('口座','account_id',options,row?.account_id || accountId || options[0][0]),
      field('残高（円）','balance_jpy',row?.balance_jpy,{type:'number',step:1,required:true})]),
    noteField(row?.note)
  ),async data=>{
    let next=stateNow()
    const values=multiple?options.map(([key],i)=>[key,int(data,'amount-'+i)]).filter(([,n])=>n!=null):[[data.get('account_id'),int(data,'balance_jpy')]]
    check(values.length,'1つ以上の残高を入力してください。')
    for (const [account_id,balance_jpy] of values) {
      next=put(next,'observations',{...row,account_id,balance_jpy,observed_on:data.get('observed_on'),recorded_at:now(),note:optional(data,'note')})
    }
    await save(next)
  },{description:multiple?'記録する口座の残高を入力してください。空欄の口座は今回の観測に含めません。':'残高は日本円の整数で入力します。',aux:deleted('observations','observation_id',row)})
}
function historyDialog(accountId) {
  const state=stateNow(),a=get('accounts','account_id',accountId)
  check(a,'口座が見つかりません。')
  const rows=active(state.observations).filter(o=>o.account_id===accountId).sort((x,y)=>y.observed_on.localeCompare(x.observed_on) || y.recorded_at.localeCompare(x.recorded_at))
  dialog(a.account_name+'の観測履歴',table(['観測日','残高','メモ','操作'],rows.map(o=>[esc(labelDate(o.observed_on)),[esc(yen(o.balance_jpy))],esc(o.note),button('編集','observation',{target:o.observation_id,variant:'ghost'})])),null,{aux:button('この口座を観測','one-observation',{symbol:'plus',target:a.account_id,variant:'primary'})})
}
function cardDialog(value) {
  ensureEdit()
  const row=get('cards','card_id',value)
  dialog(row?'カードを編集':'カードを追加',fields(
    field('カード名','card_name',row?.card_name,{required:true,maxlength:100}),field('発行会社','issuer',row?.issuer,{maxlength:100}),
    choose('既定の引落口座','debit',aOptions(a=>a.is_active && a.can_card_debit,row?.default_debit_account_id),row?.default_debit_account_id,false),
    field('表示順','sort_order',row?.sort_order,{type:'number',step:1}),field('有効','is_active',row?.is_active ?? true,{type:'checkbox'}),noteField(row?.memo)
  ),async data=>save(put(stateNow(),'cards',{...row,card_name:optional(data,'card_name'),issuer:optional(data,'issuer'),default_debit_account_id:optional(data,'debit'),sort_order:int(data,'sort_order'),is_active:data.has('is_active'),memo:optional(data,'note')})))
}
function billDialog(value) {
  ensureEdit()
  const row=get('bills','bill_id',value)
  const cards=cOptions(row?.card_id),account=aOptions(a=>a.is_active && a.can_card_debit,row?.debit_account_id)
  check(cards.length && account.length,'カードと、引落に使える口座を設定してください。')
  const cardId=row?.card_id || cards[0][0]
  dialog(row?'請求を編集':'請求を登録',fields(
    choose('カード','card_id',cards,cardId),choose('引落口座','debit',account,row?.debit_account_id || get('cards','card_id',cardId)?.default_debit_account_id),
    field('請求月','statement_month',row?.statement_month || today().slice(0,7),{type:'month',required:true}),field('引落日','payment_date',row?.payment_date || today(),{type:'date',required:true}),
    field('金額（円）','amount_jpy',row?.amount_jpy,{type:'number',step:1,required:true}),field('支払状況','status',row?.payment_status || 'Estimated',{opts:['Estimated','Confirmed','Paid'].map(s=>[s,labels[s]])}),
    field('支払日','paid_on',row?.paid_on,{type:'date',max:today()}),noteField(row?.note)
  ),async data=>{
    const state=stateNow()
    const next={...row,card_id:data.get('card_id'),debit_account_id:data.get('debit'),statement_month:data.get('statement_month'),payment_date:data.get('payment_date'),amount_jpy:int(data,'amount_jpy'),payment_status:data.get('status'),paid_on:data.get('status')==='Paid'?optional(data,'paid_on'):null,note:optional(data,'note'),updated_at:now(),reporting_disposition:row?.reporting_disposition || 'included'}
    const accountChanged=row?.debit_account_id!==next.debit_account_id
    check(!accountChanged || state.accounts.some(a=>a.account_id===next.debit_account_id && a.is_active && a.can_card_debit),'有効な引落口座を選んでください。')
    const changedGroup=Boolean(row && billKey(row)!==billKey(next))
    if (changedGroup) {
      check(!state.bills.some(b=>b.superseded_by===row.bill_id),'置換元の請求があるため、カード・請求月を変更できません。')
      next.reporting_disposition='included'
      next.superseded_by=null
    }
    const others=active(state.bills).filter(b=>b.bill_id!==row?.bill_id && billKey(b)===billKey(next) && b.reporting_disposition!=='superseded')
    let result=state
    if ((!row || changedGroup) && others.length) {
      for(const other of others) result=put(result,'bills',{...other,reporting_disposition:'pending'})
      next.reporting_disposition='pending'
    }
    await save(put(result,'bills',next))
  },{aux:deleted('bills','bill_id',row)})
  const form=modal.querySelector('form')
  form.elements.card_id.addEventListener('change',event=>{
    const debit=get('cards','card_id',event.target.value)?.default_debit_account_id || ''
    form.elements.debit.value=account.some(([key])=>key===debit)?debit:''
  })
}
function reviewBills(key) {
  ensureEdit()
  const rows=active(stateNow().bills).filter(b=>billKey(b)===key && b.reporting_disposition==='pending')
  check(rows.length,'照合する請求がありません。')
  const list=table(['支払日','金額','状態'],rows.map(r=>[esc(labelDate(r.payment_date)),[esc(yen(r.amount_jpy))],badge(r.payment_status)]))
  dialog('請求を照合',list+fields(choose('確定集計に使う請求','selected',[['all','別々の請求としてすべて含める'],...rows.map(r=>[r.bill_id,labels[r.payment_status]+' '+yen(r.amount_jpy)+' · '+labelDate(r.payment_date)])],'',true)),async data=>{
    const keep=data.get('selected')
    let state=stateNow()
    for (const row of rows) state=put(state,'bills',{...row,reporting_disposition:keep==='all' || keep===row.bill_id?'included':'superseded',superseded_by:keep==='all' || keep===row.bill_id?null:keep})
    await save(state,{message:'請求の照合結果を保存しました。'})
  })
}
function documentDialog(value) {
  ensureEdit()
  const row=get('documents','document_id',value)
  dialog(row?'資料を編集':'資料を追加',fields(
    field('対象月','document_month',row?.document_month || today().slice(0,7),{type:'month',required:true}),field('サービス名','service_name',row?.service_name,{required:true,maxlength:120}),
    choose('請求への紐付け','bill_id',docOptions(),row?.bill_id,false),field('PDF・CSV（最大10 MiB）','file','',{type:'file',accept:'.pdf,.csv',wide:true,required:!row}),
    noteField(row?.memo)
  )+(row?.legacy_file_path?note('旧資料の参照 '+row.legacy_file_path):'')+(row?.file_name?note('登録済み '+row.file_name):''),async data=>{
    check(session,'ファイルを保管するには、設定で保管庫を作成してください。')
    const file=data.get('file')
    const attached=file?.size?await makeAsset(session.root,session.dataset,file):null
    const fields={...row,...attached?.fields,document_month:data.get('document_month'),service_name:optional(data,'service_name'),bill_id:optional(data,'bill_id'),memo:optional(data,'note'),recorded_at:row?.recorded_at || now()}
    await save(put(stateNow(),'documents',fields),{objects:attached?[attached.packet]:[]})
  },{aux:(row?.blob_id?button('保存済み原本','file',{target:row.document_id}):'')+deleted('documents','document_id',row)})
}
async function getDocument(value) {
  check(session,'保管庫を解除してください。')
  const row=get('documents','document_id',value),vault=session
  check(row?.blob_id,'原本を登録してください。')
  const packet=await vault.document(available() && vault.profile.identity===credential.sub?drive:null,row)
  const data=await verifyAsset(vault.root,vault.dataset,row,packet)
  check(session===vault,'保管庫がロックされました。')
  download(new Blob([data],{type:row.document_type==='PDF'?'application/pdf':'text/csv'}),row.file_name)
}
function closingDialog() {
  ensureEdit()
  check(!session?.profile.identity || available(),'オンラインで Dropbox に接続してから締めを作成してください。')
  const prev=new Date(today().slice(0,7)+'-01T00:00:00Z'); prev.setUTCDate(0)
  dialog('月次締め',fields(field('対象月','month',prev.toISOString().slice(0,7),{type:'month',required:true,max:prev.toISOString().slice(0,7)}),noteField('','メモ・訂正理由')),async data=>{
    const month=data.get('month'),memo=optional(data,'note')
    const closing=makeClosing(stateNow(),month,memo)
    const inputs=closing.inputs.map(x=>[esc(get('accounts','account_id',x.account_id)?.account_name),esc(labelDate(x.observed_on)),[esc(yen(x.balance_jpy))]])
    dialog('月次締めを確定',note('観測 '+closing.observed_count+' / '+closing.target_count+' 口座 · 総残高 '+yen(closing.total_balance_jpy),closing.observed_count<closing.target_count)+table(['口座','採用日','残高'],inputs),async()=>{
      const verified=makeClosing(stateNow(),month,memo)
      check(canonical(verified.inputs)===canonical(closing.inputs),'観測が更新されました。締めをやり直してください。')
      await save(put(stateNow(),'monthly_closings',verified),{reason:'closing'})
    },{label:'この内容で確定'})
    return false
  },{label:'締め内容を確認'})
}
function closingDetail(value) {
  const row=get('monthly_closings','snapshot_id',value)
  check(row,'締めが見つかりません。')
  const rows=row.inputs?.map(x=>[esc(get('accounts','account_id',x.account_id)?.account_name),esc(labelDate(x.observed_on)),[esc(yen(x.balance_jpy))]])
  dialog(row.snapshot_date.slice(0,7)+' の締め',note('総残高 '+yen(row.total_balance_jpy)+' · '+row.observed_count+' / '+row.target_count+' 口座')+(rows?table(['口座','観測日','残高'],rows):empty('旧締めは集計値を移行済みです。'))+(row.note?note(row.note):''))
}

function password(label,name='phrase',create=false) {
  return field(label,name,'',{type:'password',required:true,wide:true,autocomplete:create?'new-password':'current-password',min:create?12:undefined,maxlength:1024})
}
function newDialog() {
  check(!syncing,'同期が完了してから操作してください。')
  dialog('空の保管庫を作成',fields(password('パスフレーズ（12文字以上）','phrase',true),password('パスフレーズを再入力','confirm',true)),async data=>{
    check(data.get('phrase')===data.get('confirm'),'パスフレーズが一致しません。')
    const {header,root}=await newVault(data.get('phrase'))
    await createLocal(header,root)
    go('home')
    notify('空の保管庫を作成しました。')
  },{label:'保管庫を作成',description:'十分に長いランダムな語句を設定し、安全な場所に控えてください。このパスフレーズで暗号化データを解除します。'})
}
function unlockDialog(profile) {
  check(!syncing,'同期が終わってから保管庫を切り替えてください。')
  check(profile,'保管庫が見つかりません。')
  dialog('保管庫を解除',fields(password('パスフレーズ')),async data=>{
    const root=await unlock(profile.header,data.get('phrase'))
    const next=await VaultSession.existing(profile,root)
    if (!profile.stamp) {
      check(available() && profile.identity===credential.sub,'同じ Dropbox アカウントで接続してください。')
      await next.update({...next.packet,vaultFile:profile.vaultFile})
    }
    session=next;mode='open';conflict=null;lastActive=Date.now()
    alertText=''
    await resumeConnection(next)
    await loadProfiles()
    go('home');render()
    if (session.profile.identity && available()) queuedSync={reason:'save',session}
  },{label:'解除する'})
}
function preferencesDialog() {
  check(!syncing,'同期が終わってから設定を変更してください。')
  const current=preferences()
  dialog('自動ロック・接続の記憶',fields(
    field('操作がないときの自動ロック','lock',current.autoLockMinutes,{opts:LOCK_OPTIONS,wide:true}),
    field('この端末で Dropbox 接続を記憶する','remember',current.rememberDropbox,{type:'checkbox',wide:true})
  ),async data=>{
    const next={autoLockMinutes:Number(data.get('lock')),rememberDropbox:data.has('remember')}
    if (!next.rememberDropbox && session?.packet.connection) await session.forgetConnection()
    if (next.rememberDropbox && session?.profile.identity===credential?.sub && credential?.refreshToken) await session.rememberConnection(rememberedConnection(credential))
    savePreferences(next)
    if (!next.rememberDropbox && credential) credential.refreshToken=null
    lastActive=Date.now()
    render()
    notify('この端末の設定を保存しました。')
  },{description:'接続の記憶は、保管庫を解除した後の自動接続に使います。接続情報はこの端末で保管庫と同じ鍵で暗号化します。'})
}
async function disconnect() {
  check(!syncing,'同期が終わってから接続を解除してください。')
  if (session?.packet.connection) await session.forgetConnection()
  drive?.dispose()
  credential=null;drive=null;remotes=[]
  render();notify('この保管庫の接続を解除しました。')
}
function connectionDialog() {
  check(!syncing,'同期が終わってから接続設定を変更してください。')
  const redirect=callbackUrl()
  dialog('Dropbox 接続設定',fields(field('App key','appKey',appKey(),{required:true,wide:true,maxlength:100}))+
    note('Dropbox の Redirect URIs に、次のURLを登録します。')+
    '<p class="callback-url">'+esc(redirect)+'</p>',async data=>{
      const key=String(data.get('appKey') || '').trim()
      oauthSettings(key,redirect)
      if (key!==appKey()) {drive?.dispose();credential=null;drive=null;remotes=[]}
      localStorage.setItem(KEY_SETTING,key)
      render();notify('Dropbox の接続設定を保存しました。')
    },{label:'設定を保存',description:'Dropbox アプリの Settings にある App key を入力してください。'})
}
function bindDialog() {
  check(session && available() && !session.profile.identity,'接続できる保管庫を選んでください。')
  dialog('この保管庫を Dropbox に接続',note('この保管庫のデータを暗号化した状態で、接続中の Dropbox に送信します。'),async()=>{
    check(available(),'Dropbox に再接続してください。')
    const existing=await remoteProfiles(drive)
    check(!existing.some(p=>p.header.datasetId===session.dataset),'同じ保管庫が Dropbox にあります。「Dropbox の保管庫を探す」から開いてください。')
    await session.update({...session.packet,connection:preferences().rememberDropbox && credential.refreshToken?rememberedConnection(credential):null},[],credential.sub)
    await loadProfiles()
    queuedSync={reason:'save',session}
    render()
  },{label:'暗号化して接続'})
}
function migrationDialog() {
  ensureEdit()
  const vault=session
  check(vault,'空の保管庫を作成してください。')
  const evidence=state=>state.migrationHistory.length || Object.values(SCHEMA).some(([key])=>state[key].length)
  dialog('旧シートの移行を検証',fields(field('読み取り専用スナップショット（JSON）','source','',{type:'file',accept:'.json,application/json',required:true,wide:true})),async data=>{
    const file=data.get('source')
    check(file?.size>0 && file.size<=15*1024*1024,'15 MiB 以内のスナップショットを選んでください。')
    const source=JSON.parse(await file.text())
    const formulas=(source.sheets || []).flatMap(s=>(s.formulaFindings || []).map(f=>[s.title,f.cell,f.formula,f.value]))
    if (formulas.length) {
      dialog('数式の評価値を確認',table(['タブ','セル','式','評価値'],formulas.map(r=>r.map(esc))),async()=>{
        await previewMigration(source,true,vault,evidence)
        return false
      },{label:'評価値で検証する'})
    } else await previewMigration(source,false,vault,evidence)
    return false
  },{label:'読み取って検証'})
}
async function previewMigration(source,formulas,vault,hasData) {
  const result=await importLegacy(source,formulas)
  const duplicate=vault.state.migrationHistory.some(r=>r.sourceFingerprint===result.sourceFingerprint)
  const preview=table(['移行元タブ','行数'],Object.entries(result.summary.count).map(([k,v])=>[esc(k),[esc(v)]]))
  const summary=note('総残高 '+yen(result.summary.total)+' · 観測 '+result.summary.coverage.join(' / ')+' 口座')
  const warnings=result.warnings.map(w=>note(w,true)).join('')
  if (duplicate || hasData(vault.state)) {
    dialog('移行結果',summary+preview+warnings+note(duplicate?'同じスナップショットを取り込み済みです。':'移行先にデータがあります。空の保管庫へ取り込めます。',true))
    return
  }
  dialog('移行内容を確認',summary+preview+warnings,async()=>{
    check(vault===session && !hasData(vault.state),'移行先が変更されました。空の保管庫を選んでください。')
    await save(result.state,{reason:'migration',message:'検証した旧データを保管庫に移行しました。'})
    go('home')
  },{label:'この内容を取り込む'})
}
function backupDialog(retained=false) {
  check(session && !syncing,'保管庫を解除し、同期が終わってから保存してください。')
  const snapshot=retained?session.packet.retainedDraft:session.profile.identity?session.packet.baseState:session.state
  check(snapshot && (!session.profile.identity || retained || session.packet.base && !conflict),'Dropbox の保存確認後にバックアップできます。')
  dialog('暗号化バックアップ',note(!retained && session.profile.identity && session.dirty?'Dropbox で確認済みの状態を保存します。未同期の変更は含まれません。':'復元時に、この保管庫のパスフレーズが必要です。'),async()=>{
    await exportState(snapshot)
    notify('暗号化バックアップを作成しました。')
  },{label:'ファイルを保存'})
}
function restoreDialog() {
  check(!syncing && !conflict,'同期と競合の確認を完了してから復元してください。')
  const existing=session
  dialog('バックアップを検証',fields(field('バックアップファイル','backup','',{type:'file',accept:'.shioai',required:true,wide:true}),password('バックアップ元のパスフレーズ')),async data=>{
    const restored=await readBackup(data.get('backup'),data.get('phrase'))
    const summary=control(restored.state)
    const preview=table(['種類','件数'],Object.entries(summary.count).map(([k,v])=>[esc(k),[esc(v)]]))
    const body=note('検証済み · 総残高 '+yen(summary.total)+' · 原本 '+restored.entries.size+' 件')+preview+
      fields(field('復元先','target','new',{opts:[['new','新しい保管庫'],...(existing?[['current','開いている保管庫']]:[])],wide:true}),field('新しいパスフレーズ（12文字以上）','newPhrase','',{type:'password',wide:true,autocomplete:'new-password',maxlength:1024}))
    dialog('復元内容を確認',body,async confirm=>{
      if (confirm.get('target')==='current') {
        check(existing && existing===session,'復元先の保管庫を選び直してください。')
        check(!existing.packet.pending && (!existing.profile.identity || (available() && existing.profile.identity===credential.sub && !existing.dirty)),'Dropbox の保存確認後に復元してください。')
        const marker=existing.packet.base
        if (existing.profile.identity) {
          const {heads}=await existing.graph(drive)
          check(heads.length===1 && heads[0].commitId===marker.commitId,'Dropbox に更新があります。同期し、復元をやり直してください。')
          existing.packet.needsBackup=true
          await existing.cloudBackup(drive,today())
        }
        await exportState(existing.state)
        const prepared=await restoreInto(restored,existing.root,existing.profile.header)
        if (existing.profile.identity) {
          const {heads}=await existing.graph(drive)
          check(heads.length===1 && heads[0].commitId===marker.commitId,'退避後に Dropbox が更新されました。先に同期してください。')
        }
        await save(prepared.state,{objects:prepared.objects,reason:'restore',message:'復元内容を保存しました。'})
      } else {
        const {header,root}=await newVault(confirm.get('newPhrase'))
        const prepared=await restoreInto(restored,root,header)
        await createLocal(header,root,prepared.state,prepared.objects)
        notify('新しい保管庫に復元しました。')
      }
      go('home')
    },{label:'復元する',description:'開いている保管庫に復元する場合は、復元前の暗号化バックアップを保存します。新しい保管庫を選ぶ場合は、新しいパスフレーズを設定してください。'})
    return false
  },{label:'ファイルを検証'})
}
function removeDialog(text) {
  ensureEdit()
  const [collection,key,id]=JSON.parse(text)
  check(['observations','bills','documents'].includes(collection),'この記録は無効化で管理します。')
  const row=get(collection,key,id)
  check(row,'対象の記録がありません。')
  if (collection==='bills') check(!stateNow().bills.some(b=>b.superseded_by===id && !b.deleted_at) && !stateNow().documents.some(d=>d.bill_id===id && !d.deleted_at),'資料や置換元の関連付けを先に確認してください。')
  dialog('記録を削除',note('一覧と集計から外します。同期済みの過去の版には記録が残ります。',true),async()=>{
    await save(put(stateNow(),collection,{...row,deleted_at:now()}),{message:'記録を一覧から外しました。'})
  },{label:'削除する'})
}
function humanDiff(base,state) {
  const descriptions={accounts:'口座',observations:'観測',cards:'カード',bills:'請求',documents:'資料',home:'ホーム',monthly_closings:'締め'}
  const out=[]
  for (const [table,pk] of Object.values(SCHEMA)) {
    const a=fold(base[table],pk),b=fold(state[table],pk)
    for (const key of new Set([...a.keys(),...b.keys()])) {
      const x=a.get(key),y=b.get(key)
      if (canonical(x ?? null)===canonical(y ?? null)) continue
      const r=y || x
      const name=r.account_name || r.card_name || r.service_name || get('accounts','account_id',r.account_id)?.account_name || get('cards','card_id',r.card_id)?.card_name || ''
      const value=r.balance_jpy ?? r.amount_jpy ?? r.total_balance_jpy
      out.push([descriptions[table],(!y || y.deleted_at?'削除':!x?'追加':'変更'),name,r.observed_on || r.statement_month || r.snapshot_date || '',value==null?'':yen(value)].filter(Boolean).join(' · '))
    }
  }
  return out
}
function resolutionDialog() {
  check(conflict && available() && !syncing,'現在の競合を読み直してください。')
  const current=conflict,vault=session
  const heads=current.graph.heads.map(h=>h.ref)
  const source=current.conflict?
    [['local','この端末の下書き',current.draft],['drive','Dropbox の版',current.head.state]]:
    current.graph.heads.map((h,i)=>[h.commitId,'Dropbox の版 '+(i+1)+' · '+h.commitId.slice(0,8),h.state])
  const base=current.common?.state || emptyState()
  let proposal=current.merged
  if (!proposal && source.length===2 && current.common) proposal=mergeStates(base,source[0][2],source[1][2])
  const comparison=source.map(([,label,state])=>'<div><h3>'+esc(label)+'</h3><pre>'+esc(humanDiff(base,state).join('\n') || '共通版と同じ内容')+'</pre></div>').join('')
  const choices=source.map(([key,label])=>[key,label+'を採用'])
  const editable=proposal?.conflicts?.length && proposal.conflicts.every(c=>c.table && !c.group && Object.hasOwn(c,'left'))
  const comparisonFields=editable?proposal.conflicts.map((c,i)=>choose(c.table+' · '+c.id.slice(0,12),'field-'+i,[['left',source[0][1]],['right',source[1][1]]],'',false)):[]
  if (proposal && !proposal.conflicts.length) choices.unshift(['combine','変更を両方取り込む'])
  else if (editable) choices.unshift(['fields','変更ごとに選択する'])
  dialog('保存の競合を解決','<div class="diff">'+comparison+'</div>'+fields(choose('採用内容','resolution',choices,'',true),...comparisonFields),async data=>{
    check(current===conflict && vault===session,'最新の競合を読み直してください。')
    const selection=data.get('resolution')
    let state
    if (selection==='combine') state=proposal.result
    else if (selection==='fields') {
      state=structuredClone(proposal.result)
      for (const [i,c] of proposal.conflicts.entries()) {
        check(data.get('field-'+i),'変更ごとの採用元を選んでください。')
        const row=c[data.get('field-'+i)]
        if (row) state[c.table].push(row)
      }
    } else state=source.find(([key])=>key===selection)[2]
    validate(state)
    await sync('merge',{heads,state},vault)
    check(conflict!==current && !alertText,alertText || '競合の内容が変わりました。再度確認してください。')
  },{label:'この内容で統合',description:'元の Dropbox の版は残ります。競合前に端末だけにあった下書きは、設定から暗号化バックアップを保存できます。'})
}

async function act(action,value) {
  const actions={
    range:()=>{range=value;render()},settings:()=>go('settings'),close:()=>modal.close(),
    account:()=>accountDialog(value),observation:()=>observationDialog(value), 'one-observation':()=>observationDialog('',value),'obs-history':()=>historyDialog(value),
    card:()=>cardDialog(value),bill:()=>billDialog(value),'bill-review':()=>reviewBills(value),
    document:()=>documentDialog(value),file:()=>getDocument(value),closing:closingDialog,'closing-view':()=>closingDetail(value),
    new:newDialog,unlock:()=>unlockDialog(locals[Number(value)]),'remote-unlock':()=>unlockDialog(remotes.find(p=>p.key===value)),
    lock:()=>{check(!syncing,'同期が終わってからロックしてください。');clearVault()},demo:()=>{clearVault({showDemo:true});go('home')},
    'connection-settings':connectionDialog,preferences:preferencesDialog,connect:()=>{check(!syncing,'同期が終わってから再接続してください。');return startOAuth(appKey())},discover,bind:bindDialog,sync:()=>sync(),resolve:resolutionDialog,
    disconnect,
    backup:()=>backupDialog(),retained:()=>backupDialog(true),restore:restoreDialog,migration:migrationDialog,delete:()=>removeDialog(value),
  }
  if (Object.hasOwn(actions,action)) await actions[action]()
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('button[data-action]')
  if (!target) return
  lastActive=Date.now()
  try { await act(target.dataset.action,target.dataset.id) }
  catch (error) {
    const out=modal.open?modal.querySelector('.error'):null
    if (out) out.textContent=error.message
    else notify(error.message || '操作を完了できませんでした。')
  }
})
modal.addEventListener('submit',async event=>{
  event.preventDefault()
  if (!submitHandler || event.target.dataset.busy) return
  const form=event.target,fn=submitHandler
  const errorMessage=form.querySelector('.error')
  const controls=form.querySelectorAll('button')
  const data=new FormData(form)
  form.dataset.busy='true'
  errorMessage.textContent=''
  controls.forEach(x=>x.disabled=true)
  try {
    const result=await fn(data)
    if (result!==false && fn===submitHandler) modal.close()
    if (queuedSync && !modal.open) {
      const next=queuedSync
      queuedSync=null
      void sync(next.reason,null,next.session)
    }
  } catch (error) { errorMessage.textContent=error.message || '操作を完了できませんでした。' }
  finally { delete form.dataset.busy; controls.forEach(x=>x.disabled=false) }
})
modal.addEventListener('cancel',event=>{if (modal.querySelector('form')?.dataset.busy) event.preventDefault()})
modal.addEventListener('close',()=>{modal.replaceChildren();submitHandler=null})
window.addEventListener('hashchange',()=>{if (modal.open) modal.close();render();window.scrollTo(0,0)})
window.addEventListener('resize',()=>{if (mode!=='locked') drawCharts(conflict?.common?.state || stateNow(),range)})
const recordActivity=()=>{lastActive=Date.now()}
for (const event of ['pointerdown','keydown','input','scroll']) window.addEventListener(event,recordActivity,{passive:true,capture:true})
window.addEventListener('online',()=>{render();void sync()})
window.addEventListener('offline',render)
function activityCheck() {
  if (session && lockDue(preferences().autoLockMinutes,lastActive) && !syncing && !modal.querySelector('form')?.dataset.busy) {
    clearVault()
    return
  }
  if (session && document.visibilityState==='visible' && Date.now()-lastPoll>60000 && !conflict) void sync()
}
window.addEventListener('focus',activityCheck)
document.addEventListener('visibilitychange',activityCheck)
setInterval(activityCheck,15000)
bus?.addEventListener('message',async event=>{
  if (!session || event.data!==session.profile.key || syncing) return
  const cached=await profiles()
  if (cached.some(p=>p.key===session.profile.key && p.stamp!==session.profile.stamp)) notify('別のタブで変更されました。読み込み直すと最新の下書きを表示できます。')
})

async function init() {
  await loadProfiles()
  mode=locals.length?'locked':'demo'
  if (location.pathname.endsWith('/oauth/callback.html')) {
    try {
      credential=await finishOAuth()
      if (credential) drive=clientFor(credential)
    } catch (error) { alertText=error.message }
    history.replaceState(null,'',startPage.pathname+'#settings')
  }
  render()
  if (drive) await discover().catch(error=>{alertText=error.message;render()})
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(new URL('../sw.js',import.meta.url)).catch(()=>notify('オフライン用の画面を準備できませんでした。'))
  }
}
init().catch(error=>{
  render()
  notify(error.message || 'ブラウザの端末内保存を利用できません。')
})
