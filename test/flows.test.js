import test from 'node:test'
import assert from 'node:assert/strict'
import {SCHEMA,SHEET_IDS,SOURCE_ID,billKey,canonical,closingChanged,control,demoState,emptyState,hash,importLegacy,makeClosing,mergeStates,put,projection,today,validate} from '../site/js/domain.js'
import {createBackup,makeAsset,newVault,open,readBackup,restoreInto,seal,unlock,verifyAsset} from '../site/js/storage.js'
import {VaultSession,commonBase,initialPacket} from '../site/js/drive.js'
import {chartData,homeView,observationsView,billsView,docsView,reportsView,shell} from '../site/js/view.js'

const password='sample grass lighthouse record'
const demo=demoState()
const fixture = () => ({
  sourceVersion:1,spreadsheetId:SOURCE_ID,locale:'ja_JP',timeZone:'Asia/Tokyo',
  sheets:Object.entries(SCHEMA).map(([title,[table,...header]],i)=>{
    let rows=demo[table]
    if (title==='Bills') rows=[...rows,{...rows[0],bill_id:'estimate',payment_status:'Estimated'}]
    return {title,sheetId:SHEET_IDS[i],header,formulaFindings:[],rows:rows.map((r,n)=>({rowNumber:n+2,values:header.map(k=>
      k==='file_path'?r.legacy_file_path ?? null:
      k==='recorded_at'?46346.5:r[k] ?? null)}))}
  })
})

test('ダッシュボードの各画面をサンプルで描画し、未観測とゼロを区別する',()=>{
  assert.equal(validate(demo),demo)
  assert.equal(projection(emptyState()).total,null)
  const observations=demo.observations.map(o=>({...o,balance_jpy:0}))
  assert.equal(projection({...demo,observations}).total,0)
  for (const [route,fn] of Object.entries({home:homeView,observations:observationsView,bills:billsView,documents:docsView,reports:reportsView})) {
    const html=shell(route,{kind:'demo',text:'サンプルデータ'},fn(demo,'6'))
    assert.match(html,/しおあい家計OS/)
    assert.match(html,/aria-current="page"/)
    assert.doesNotMatch(html,/undefined|NaN/)
  }
  assert.ok(chartData(demo,'6').length<=chartData(demo,'0').length)
})

test('7タブの移行で支払状態、日付、指紋と照合候補を保持する',async()=>{
  const first=await importLegacy(fixture())
  const second=await importLegacy(fixture())
  assert.equal(first.sourceFingerprint,second.sourceFingerprint)
  assert.equal(Object.keys(first.summary.count).length,7)
  assert.equal(first.summary.count.MonthlyClosings,0)
  assert.equal(first.state.bills.filter(x=>x.reporting_disposition==='pending').length,2)
  assert.equal(first.state.bills.find(x=>x.bill_id==='estimate').payment_status,'Estimated')
  assert.equal(first.state.observations[0].recorded_at.slice(11,16),'03:00')
  assert.ok(first.state.migrationHistory[0].evidence.every(x=>x.sourceHash.length===64 && x.recordHash.length===64))
  assert.deepEqual(control(first.state),first.summary)
  const bad=fixture()
  bad.sheets[0].rows[1].values[0]=bad.sheets[0].rows[0].values[0]
  await assert.rejects(importLegacy(bad),/重複ID/)
  const formula=fixture()
  formula.sheets[0].formulaFindings.push({cell:'B2',formula:'=1',value:1,error:'ERROR'})
  await assert.rejects(importLegacy(formula,true),/数式エラー/)
})

test('月次締めの口座明細を固定し、過去観測を変更した時に検出する',()=>{
  let state=structuredClone(demo)
  const closing=makeClosing(state,'2026-10',null)
  state=put(state,'monthly_closings',closing)
  assert.equal(closingChanged(state,closing),false)
  const changed=put(state,'observations',{account_id:'jp',observed_on:'2026-10-31',recorded_at:'2026-11-01T00:00:00.000Z',balance_jpy:45})
  assert.equal(closingChanged(changed,closing),true)
  assert.equal(state.monthly_closings[0].total_balance_jpy,closing.total_balance_jpy)
  const proposal=mergeStates(demo,state,put(demo,'observations',{account_id:'jp',observed_on:'2026-10-31',recorded_at:'2026-11-01T00:00:00.000Z',balance_jpy:45}))
  assert.ok(proposal.conflicts.some(x=>x.table==='monthly_closings'))
})

test('暗号化・誤パスフレーズ・添付・改変検出・別保管庫への復元',async()=>{
  const {header,root}=await newVault(password)
  const fresh=await unlock(header,password)
  await assert.rejects(unlock(header,'a different password'))
  const packet=await seal(root,header.datasetId,'local',{working:demo})
  assert.notEqual(packet.ciphertext.includes('ゆうちょ銀行'),true)
  assert.equal((await open(fresh,header.datasetId,'local',packet)).working.accounts.length,6)
  const raw=new File(['日付,金額\n2026-10-01,10\n'],'test.csv')
  const {packet:attachment,fields}=await makeAsset(root,header.datasetId,raw)
  const record={...demo.documents[0],...fields}
  const actual=put(demo,'documents',record)
  const backup=await createBackup(root,header,actual,()=>attachment)
  const output=await readBackup(backup,password)
  assert.equal(output.entries.size,1)
  const next=await newVault('another sample passphrase')
  const restored=await restoreInto(output,next.root,next.header)
  const restoredDoc=restored.state.documents.find(x=>x.blob_id)
  assert.notEqual(restoredDoc.blob_id,record.blob_id)
  assert.equal(new TextDecoder().decode(await verifyAsset(next.root,next.header.datasetId,restoredDoc,restored.objects[0])),await raw.text())
  const bad=JSON.parse(await backup.text())
  bad.entries.at(-1).ciphertext='AQID'
  await assert.rejects(readBackup(new Blob([JSON.stringify(bad)]),password),/一致/)
})

class MemoryDrive {
  credential={sub:'test-user',expiresAt:Date.now()+600000}
  entries=new Map()
  counter=0
  fault=false
  hidden=new Set()
  async list(){return [...this.entries.values()].filter(v=>!this.hidden.has(v.id))}
  async nextId(){return 'drive-'+ ++this.counter}
  async get(id){const item=this.entries.get(id);if(!item) throw Object.assign(new Error('missing'),{status:404});return structuredClone(item.data)}
  async ensure(id,data,kind,dataset) {
    if(this.entries.has(id)) {
      assert.deepEqual(data,this.entries.get(id).data)
      return
    }
    this.entries.set(id,{id,data,appProperties:{kind,dataset}})
    if(this.fault) {this.fault=false;throw new Error('response lost')}
  }
}
class TestSession extends VaultSession {
  async update(next,objects=[],identity=this.profile.identity) {
    this.packet=structuredClone(next)
    this.profile={...this.profile,identity}
  }
}
test('Driveの応答喪失で二重保存を防ぎ、端末分岐を残してから統合する',async()=>{
  const {header,root}=await newVault(password)
  const drive=new MemoryDrive()
  const a=new TestSession({header,identity:'test-user',deviceId:'pc'},root,initialPacket(demo))
  drive.fault=true
  await assert.rejects(a.publish(drive),/response lost/)
  const before=a.packet.pending.fileId
  await a.publish(drive)
  assert.equal(a.packet.base.driveFileId,before)
  const baseline=structuredClone(a.packet)
  const b=new TestSession({header,identity:'test-user',deviceId:'phone'},root,baseline)
  const stateA=put(a.state,'accounts',{...a.state.accounts[0],account_name:'PC observation'})
  const stateB=put(b.state,'accounts',{...b.state.accounts[1],account_name:'Phone observation'})
  const parents=[a.packet.base]
  await a.prepare(drive,stateA,parents,'save')
  await b.prepare(drive,stateB,parents,'save')
  await a.send(drive)
  await b.send(drive)
  const graph=(await a.publish(drive)).graph
  assert.equal(graph.heads.length,2)
  assert.ok(commonBase(graph))
  const base=commonBase(graph).state
  const merged=mergeStates(base,...graph.heads.map(h=>h.state))
  assert.equal(merged.conflicts.length,0)
  const result=await a.publish(drive,{resolution:{heads:graph.heads.map(h=>h.ref),state:merged.result}})
  assert.equal(result.graph.heads.length,1)
  await b.publish(drive)
  assert.equal(a.packet.base.stateHash,b.packet.base.stateHash)
  drive.hidden.add(a.packet.base.driveFileId)
  assert.equal((await a.graph(drive)).heads[0].ref.driveFileId,a.packet.base.driveFileId)
  assert.equal([...drive.entries.values()].filter(v=>v.appProperties.kind==='commit').length,4)
})
