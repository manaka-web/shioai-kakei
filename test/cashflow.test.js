import test from 'node:test'
import assert from 'node:assert/strict'
import {SCHEMA,canonical,cashflowEntries,cashflowInputs,cashflowSummary,closingChanged,duplicateCashflow,emptyState,hash,makeClosing,mergeStates,orderState,projection,put,validate} from '../site/js/domain.js'
import {createBackup,newVault,open,readBackup,restoreInto,seal} from '../site/js/storage.js'
import {VaultSession,initialPacket} from '../site/js/sync.js'
import {cashflowView,homeView,reportsView,shell} from '../site/js/view.js'

const month='2020-10',stamp='2020-10-20T00:00:00.000Z'
function base() {
  let state=emptyState()
  for(const account_id of ['bank','cash']) state=put(state,'accounts',{account_id,account_name:account_id,account_type:'Bank',balance_category:'Ordinary',include_total:true,is_active:true,can_card_debit:true})
  state=put(state,'observations',{account_id:'bank',observed_on:'2020-10-20',balance_jpy:123456,recorded_at:stamp})
  return put(state,'cards',{card_id:'card',card_name:'Test card',is_active:true,default_debit_account_id:'bank'})
}
const transaction=(overrides={})=>({kind:'income',status:'posted',title:'Salary',amount_jpy:100000,occurred_on:'2020-10-20',account_id:'bank',to_account_id:null,category:null,recorded_at:stamp,updated_at:stamp,...overrides})
const bill=(overrides={})=>({card_id:'card',statement_month:'2020-09',payment_date:'2020-10-25',amount_jpy:3000,payment_status:'Confirmed',paid_on:null,debit_account_id:'bank',reporting_disposition:'included',...overrides})

test('収入・支出・振替・予定とカードの支払日を集計し、観測残高は変えない',()=>{
  let state=put(base(),'transactions',transaction())
  state=put(state,'transactions',transaction({kind:'expense',amount_jpy:2000}))
  state=put(state,'transactions',transaction({kind:'income',status:'planned',amount_jpy:4000}))
  state=put(state,'transactions',transaction({kind:'transfer',amount_jpy:8000,to_account_id:'cash'}))
  state=put(state,'bills',bill())
  state=put(state,'bills',bill({statement_month:'2020-08',payment_date:'2020-09-25',payment_status:'Paid',paid_on:'2020-10-01',amount_jpy:5000}))
  state=put(state,'bills',bill({statement_month:'2020-07',payment_status:'Paid',paid_on:'2020-10-02',amount_jpy:-700}))
  state=put(state,'bills',bill({statement_month:'2020-06',reporting_disposition:'pending',amount_jpy:9999}))
  const kept=state.bills[0]
  state=put(state,'bills',bill({statement_month:kept.statement_month,reporting_disposition:'superseded',superseded_by:kept.bill_id,amount_jpy:8888}))
  const deleted=transaction({kind:'expense',amount_jpy:99999,deleted_at:stamp})
  state=put(state,'transactions',deleted)
  validate(state)
  assert.deepEqual(cashflowSummary(state,month),{income:100000,expense:6300,net:93700,plannedIncome:4000,plannedExpense:3000,transfers:8000,unresolved:1})
  assert.equal(cashflowEntries(state,month).length,7)
  assert.equal(cashflowSummary(state,'2020-09').expense,0)
  assert.equal(projection(state).total,projection(base()).total)
  const paid=put(state,'bills',{...kept,payment_status:'Paid',paid_on:'2020-10-25'})
  assert.equal(cashflowSummary(paid,month).expense,9300)
  assert.equal(cashflowSummary(paid,month).plannedExpense,0)
  assert.equal(cashflowEntries(paid,month).filter(x=>x.source_id===kept.bill_id).length,1)
})

test('カードと同じ手入力の候補を検出し、自分自身・異なる口座・振替を除外する',()=>{
  let state=put(base(),'bills',bill({payment_status:'Paid',paid_on:'2020-10-20'}))
  const candidate=transaction({kind:'expense',amount_jpy:3000})
  assert.equal(duplicateCashflow(state,candidate)[0].source,'bill')
  state=put(state,'transactions',{...candidate,transaction_id:'mine'})
  assert.equal(duplicateCashflow(state,{...candidate,transaction_id:'mine'}).length,1)
  assert.equal(duplicateCashflow(state,{...candidate,account_id:'cash'}).length,0)
  assert.equal(duplicateCashflow(state,{...candidate,status:'planned'}).length,0)
  assert.equal(duplicateCashflow(state,{...candidate,kind:'transfer',to_account_id:'cash'}).length,0)
})

test('収支の不正日付・小数・負数・欠落口座・未来の入出金済み・自己振替を拒否する',()=>{
  for(const fields of [{occurred_on:'2020-02-30'},{amount_jpy:1.5},{amount_jpy:-1},{amount_jpy:0},{account_id:'missing'},{occurred_on:'9999-12-31'},{title:' '},{kind:'transfer',to_account_id:'bank'},{kind:'transfer',to_account_id:'missing'},{kind:'income',to_account_id:'cash'}]) {
    assert.throws(()=>validate(put(base(),'transactions',transaction(fields))))
  }
  assert.throws(()=>validate({...base(),transactions:null}))
  assert.doesNotThrow(()=>validate(put(base(),'transactions',transaction({status:'planned',occurred_on:'9999-12-31'}))))
})

test('締めに収支を固定し、過去の追記・編集・削除や同時編集を検出する',()=>{
  const state=put(base(),'transactions',transaction({transaction_id:'salary'}))
  const closing=makeClosing(state,month,null)
  const frozen=put(state,'monthly_closings',closing)
  assert.equal(closing.income_jpy,100000)
  assert.equal(closingChanged(frozen,closing),false)
  const changed=put(frozen,'transactions',{...state.transactions[0],amount_jpy:200000})
  assert.equal(closingChanged(changed,closing),true)
  assert.equal(changed.monthly_closings[0].income_jpy,100000)
  assert.equal(closingChanged(put(frozen,'transactions',{...state.transactions[0],deleted_at:stamp}),closing),true)
  assert.equal(closingChanged(put(frozen,'transactions',transaction({kind:'expense',amount_jpy:100})),closing),true)
  assert.equal(closingChanged(put(frozen,'transactions',transaction({kind:'expense',status:'planned',amount_jpy:100})),closing),false)
  const other=put(state,'transactions',{...state.transactions[0],amount_jpy:200000})
  assert.ok(mergeStates(state,frozen,other).conflicts.some(x=>x.table==='monthly_closings'))
  assert.throws(()=>makeClosing(frozen,month,null),/訂正理由/)
  const corrected=makeClosing(changed,month,'入金の訂正')
  assert.equal(corrected.income_jpy,200000)
  assert.equal(corrected.supersedes_snapshot_id,frozen.monthly_closings[0].snapshot_id)
  assert.doesNotThrow(()=>validate(put(changed,'monthly_closings',corrected)))
  assert.throws(()=>validate({...frozen,monthly_closings:[{...frozen.monthly_closings[0],income_jpy:1}]}),/収支/)
  assert.throws(()=>validate({...frozen,monthly_closings:[{...frozen.monthly_closings[0],cashflow_inputs:null}]}),/収支/)
  assert.throws(()=>validate({...frozen,monthly_closings:[{...frozen.monthly_closings[0],cashflow_inputs:[...closing.cashflow_inputs,...closing.cashflow_inputs]}]}),/収支/)
})

test('収支の分岐は別々の記録を保持し、同一記録の編集と似た二重登録を競合にする',()=>{
  const state=put(base(),'transactions',transaction({transaction_id:'salary'}))
  const left=put(state,'transactions',{...state.transactions[0],amount_jpy:200000})
  const right=put(state,'transactions',{...state.transactions[0],amount_jpy:300000})
  assert.ok(mergeStates(state,left,right).conflicts.some(x=>x.table==='transactions' && x.id==='salary'))
  const addedA=put(state,'transactions',transaction({kind:'expense',amount_jpy:100}))
  const addedB=put(state,'transactions',transaction({kind:'expense',amount_jpy:200}))
  const merged=mergeStates(state,addedA,addedB)
  assert.equal(merged.conflicts.length,0)
  assert.equal(cashflowSummary(merged.result,month).expense,300)
  assert.ok(mergeStates(state,addedA,put(state,'transactions',transaction({kind:'expense',amount_jpy:100}))).conflicts.some(x=>x.table==='transactions' && x.group))
})

test('旧形式の配列不在とハッシュを維持し、新旧バックアップを読み込む',async()=>{
  const legacy=base();delete legacy.transactions
  const oldOrder={...legacy,...Object.fromEntries(Object.values(SCHEMA).map(([table,pk])=>[table,[...legacy[table]].sort((a,b)=>a[pk]<b[pk]?-1:Number(a[pk]>b[pk]))]))}
  assert.equal(canonical(orderState(legacy)),canonical(oldOrder))
  assert.doesNotThrow(()=>validate(legacy))
  assert.equal(cashflowSummary(legacy,month).income,0)
  const phrase='cashflow test lighthouse password',vault=await newVault(phrase)
  const raw=JSON.parse(await (await createBackup(vault.root,vault.header,legacy,()=>null)).text())
  raw.version=1
  assert.deepEqual((await readBackup(new Blob([canonical(raw)]),phrase)).state,orderState(legacy))
  const state=put(legacy,'transactions',transaction())
  const backup=await createBackup(vault.root,vault.header,state,()=>null)
  assert.equal(JSON.parse(await backup.text()).version,2)
  const loaded=await readBackup(backup,phrase)
  const next=await newVault('another cashflow vault phrase')
  const restored=await restoreInto(loaded,next.root,next.header)
  assert.equal(cashflowSummary(restored.state,month).income,100000)
  assert.equal(canonical(restored.state.transactions),canonical(state.transactions))
})

class Drive {
  credential={sub:'test-user'}
  entries=new Map()
  count=0
  async nextId(){return 'file-'+ ++this.count}
  async list(){return [...this.entries.values()]}
  async get(key){return structuredClone(this.entries.get(key).data)}
  async ensure(key,data,kind,dataset){this.entries.set(key,{id:key,data:structuredClone(data),appProperties:{kind,dataset}})}
}
class Session extends VaultSession {
  async update(packet){this.packet=structuredClone(packet)}
}
test('旧コミットを開き、収支をschema2で同期し、2端末の追記と締めハッシュを保持する',async()=>{
  const {header,root}=await newVault('synchronization test lighthouse'),drive=new Drive()
  const legacy=base();delete legacy.transactions
  const commitId='old-commit',stateHash=await hash(canonical(orderState(legacy)))
  const ref={commitId,stateHash,driveFileId:'legacy'}
  const payload={commitId,stateHash,state:legacy,schemaVersion:1,reducerVersion:1,parentRefs:[]}
  await drive.ensure('legacy',await seal(root,header.datasetId,'commit',payload,commitId),'commit',header.datasetId)
  await drive.ensure('marker',{header,genesis:await seal(root,header.datasetId,'marker',{genesis:ref})},'vault',header.datasetId)
  const packet={...initialPacket(legacy),baseState:legacy,base:ref,known:[ref],vaultFile:'marker'}
  const profile={header,identity:'test-user',deviceId:'pc'}
  const a=new Session(profile,root,structuredClone(packet)),b=new Session({...profile,deviceId:'iphone'},root,structuredClone(packet))
  assert.equal((await a.graph(drive)).heads[0].schemaVersion,1)
  await a.stage(put(a.state,'transactions',transaction({transaction_id:'pc'})))
  await b.stage(put(b.state,'transactions',transaction({transaction_id:'phone',kind:'expense',amount_jpy:1200})))
  await a.publish(drive)
  await b.publish(drive)
  await a.publish(drive)
  assert.equal(a.state.transactions.length,2)
  assert.equal(a.packet.base.stateHash,b.packet.base.stateHash)
  const graph=await a.graph(drive)
  assert.equal(graph.heads[0].schemaVersion,2)
  assert.equal(graph.heads[0].reducerVersion,2)
  const closing=makeClosing(a.state,month,null)
  await a.stage(put(a.state,'monthly_closings',closing))
  await a.publish(drive)
  const frozen=a.state.monthly_closings[0]
  assert.equal(frozen.cashflow_hash,await hash(canonical(cashflowInputs(a.state,month))))
  const fresh=new Session(profile,root,structuredClone(a.packet))
  assert.equal((await fresh.graph(drive)).heads.length,1)
  const bad=drive.entries.get(a.packet.base.driveFileId)
  const decoded=await open(root,header.datasetId,'commit',bad.data)
  decoded.state.monthly_closings[0].cashflow_hash='bad'
  decoded.stateHash=await hash(canonical(orderState(decoded.state)))
  bad.data=await seal(root,header.datasetId,'commit',decoded,decoded.commitId)
  // Read without a known-tip hash so validation reaches the closing integrity check.
  await assert.rejects(new Session(profile,root,{...a.packet,known:[]}).graph(drive),/収支ハッシュ/)
})

test('空の保管庫と旧データでも3指標と収支画面を描画し、文字列をエスケープする',()=>{
  const state=put(base(),'transactions',transaction({title:'<script>alert(1)</script>'}))
  for(const [route,html] of [['home',homeView(emptyState(),'6',month)],['cashflow',cashflowView(state,month)],['reports',reportsView(state,'6',month)]]) {
    const page=shell(route,{kind:'demo',text:'sample'},html)
    assert.doesNotMatch(page,/undefined|NaN|<script>/)
    assert.match(page,/aria-current="page"/)
  }
  assert.match(cashflowView(state,month),/&lt;script&gt;/)
  assert.match(homeView(emptyState(),'6',month),/現在の総残高/)
})
