export const SCHEMA = {
  Accounts: ['accounts','account_id','account_name','account_type','institution_name','purpose','include_total','is_active','sort_order','memo','balance_category','can_card_debit'],
  Observations: ['observations','observation_id','observed_on','account_id','balance_jpy','note','recorded_at'],
  Cards: ['cards','card_id','card_name','issuer','default_debit_account_id','is_active','sort_order','memo'],
  Bills: ['bills','bill_id','card_id','statement_month','payment_date','amount_jpy','payment_status','debit_account_id','paid_on','note','updated_at'],
  Documents: ['documents','document_id','document_month','service_name','document_type','file_path','bill_id','memo','recorded_at'],
  Home: ['home','home_id','home_title','overview_note'],
  MonthlyClosings: ['monthly_closings','snapshot_id','snapshot_date','note','recorded_at','total_balance_jpy','observed_count','target_count','liquid_balance_jpy','term_balance_jpy'],
}
export const SOURCE_ID = '1ZyFxpgV1yXho2hvGgAHtApIOZe5nro8UFpbDZzvLmhY'
export const SHEET_IDS = [653572779, 1101, 1102, 1103, 1104, 1105, 1110]
export const labels = {Bank:'銀行',EWallet:'電子マネー',Ordinary:'普通預金',Term:'定期預金',Estimated:'見込',Confirmed:'確定',Paid:'支払済',pending:'要照合',superseded:'置換済'}
export const id = () => crypto.randomUUID()
export const active = rows => rows.filter(row => !row.deleted_at)
export const yen = value => value == null ? '—' : new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(value)
export const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const now = () => new Date().toISOString()
const compare = (a,b) => a < b ? -1 : Number(a > b)
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(item=>canonical(item ?? null)).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
export const bytes = value => new TextEncoder().encode(value)
export async function hash(value) {
  const data = typeof value === 'string' ? bytes(value) : value
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)), x => x.toString(16).padStart(2,'0')).join('')
}
export function check(ok, message) { if (!ok) throw new Error(message) }
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value
export const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
export const validInstant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && !Number.isNaN(Date.parse(value))
export const monthEnd = month => new Date(Date.parse(month+'-01T00:00:00Z') + 32*86400000 - new Date(Date.parse(month+'-01T00:00:00Z') + 32*86400000).getUTCDate()*86400000).toISOString().slice(0,10)
export function emptyState() {
  return {...Object.fromEntries(Object.values(SCHEMA).map(([key]) => [key,[]])),migrationHistory:[]}
}
export function orderState(state) {
  return {...state,...Object.fromEntries(Object.values(SCHEMA).map(([key,pk]) => [key,[...state[key]].sort((a,b) => compare(a[pk],b[pk]))]))}
}
export const fold = (rows,key) => new Map(rows.map(r => [r[key],r]))
export const billKey = r => r.card_id+'|'+r.statement_month
export const obsKey = r => r.account_id+'|'+r.observed_on
export const total = list => list.reduce((a,b) => {
  const value = a+b
  check(Number.isSafeInteger(value),'金額の合計が扱える範囲を超えています。')
  return value
},0)
export function validate(state) {
  check(state && Array.isArray(state.migrationHistory),'データ形式が一致しません。')
  for (const [table,pk] of Object.values(SCHEMA)) {
    const rows = state[table]
    check(Array.isArray(rows) && rows.every(r => r && typeof r[pk] === 'string' && r[pk].trim() && typeof r.record_rev === 'string'), table+' の主キーまたは版が無効です。')
    check(new Set(rows.map(r => r[pk])).size === rows.length,table+' に重複IDがあります。')
  }
  const account = fold(state.accounts,'account_id'), card = fold(state.cards,'card_id'), bill = fold(state.bills,'bill_id')
  const nonempty = x => typeof x === 'string' && x.trim().length > 0
  for (const a of state.accounts) check(nonempty(a.account_name) && ['Bank','EWallet'].includes(a.account_type) && ['Ordinary','Term','EWallet'].includes(a.balance_category) && ['is_active','include_total','can_card_debit'].every(k => typeof a[k]==='boolean') && (a.sort_order==null || Number.isSafeInteger(a.sort_order)),'口座の必須項目を確認してください。')
  for (const o of state.observations) check(account.has(o.account_id) && validDate(o.observed_on) && Number.isSafeInteger(o.balance_jpy) && validInstant(o.recorded_at),'観測の口座・日付・金額・記録時刻を確認してください。')
  for (const c of state.cards) check(nonempty(c.card_name) && typeof c.is_active==='boolean' && (c.default_debit_account_id==null || account.has(c.default_debit_account_id)) && (c.sort_order==null || Number.isSafeInteger(c.sort_order)),'カードまたは既定引落口座を確認してください。')
  for (const b of state.bills) {
    check(card.has(b.card_id) && account.has(b.debit_account_id) && validMonth(b.statement_month) && validDate(b.payment_date) && Number.isSafeInteger(b.amount_jpy),'請求のカード・引落口座・月・日付・金額を確認してください。')
    check(['Estimated','Confirmed','Paid'].includes(b.payment_status) && (b.payment_status==='Paid' ? validDate(b.paid_on) : b.paid_on==null) && (b.updated_at==null || validInstant(b.updated_at)),'支払状況と支払日を確認してください。')
    check(['included','pending','superseded'].includes(b.reporting_disposition) && (b.reporting_disposition!=='superseded' || (bill.has(b.superseded_by) && b.superseded_by!==b.bill_id && billKey(bill.get(b.superseded_by))===billKey(b))),'請求の照合状態を確認してください。')
  }
  for (const d of state.documents) {
    check(validMonth(d.document_month) && nonempty(d.service_name) && validInstant(d.recorded_at) && ['PDF','CSV','Other'].includes(d.document_type) && (d.bill_id==null || bill.has(d.bill_id)),'資料の月・サービス・種類・請求参照を確認してください。')
    check(!d.blob_id || (nonempty(d.file_name) && /^[0-9a-f]{64}$/.test(d.sha256) && Number.isSafeInteger(d.size) && d.size>0 && d.size<=10*1024*1024),'資料の添付情報が無効です。')
  }
  check(active(state.home).length<=1,'ホーム設定が複数あります。')
  const closings = active(state.monthly_closings)
  for (const c of state.monthly_closings) {
    check(validDate(c.snapshot_date) && validInstant(c.recorded_at) && Number.isSafeInteger(c.total_balance_jpy) && Number.isSafeInteger(c.liquid_balance_jpy) && Number.isSafeInteger(c.term_balance_jpy) && c.total_balance_jpy===total([c.liquid_balance_jpy,c.term_balance_jpy]) && Number.isInteger(c.observed_count) && Number.isInteger(c.target_count) && c.observed_count>=0 && c.target_count>=c.observed_count,'月次締めの内訳や件数が一致しません。')
    if (c.inputs) {
      check(c.inputs.length===c.target_count && new Set(c.inputs.map(x=>x.account_id)).size===c.inputs.length && c.inputs.every(x=>account.has(x.account_id) && ['Ordinary','Term','EWallet'].includes(x.balance_category) && (x.balance_jpy==null || Number.isSafeInteger(x.balance_jpy))),'締めの口座明細が無効です。')
      const seen=c.inputs.filter(x=>x.balance_jpy!=null)
      check(seen.length===c.observed_count && total(seen.filter(x=>x.balance_category==='Term').map(x=>x.balance_jpy))===c.term_balance_jpy && total(seen.filter(x=>x.balance_category!=='Term').map(x=>x.balance_jpy))===c.liquid_balance_jpy,'保存済みの締め明細と内訳が一致しません。')
    }
    if (c.supersedes_snapshot_id) check(c.supersedes_snapshot_id!==c.snapshot_id && closings.some(p=>p.snapshot_id===c.supersedes_snapshot_id && p.snapshot_date.slice(0,7)===c.snapshot_date.slice(0,7)),'訂正対象の締めが見つかりません。')
  }
  check(new Set(currentClosings(state).map(c=>c.snapshot_date.slice(0,7))).size===currentClosings(state).length,'同じ月に有効な締めが複数あります。')
  return state
}
export function currentClosings(state) {
  const rows = active(state.monthly_closings)
  const superseded = new Set(rows.map(r=>r.supersedes_snapshot_id).filter(Boolean))
  return rows.filter(r=>!superseded.has(r.snapshot_id))
}
export function put(state, table, row) {
  const pk = Object.values(SCHEMA).find(s=>s[0]===table)[1]
  const stored = {...row,[pk]:row[pk] || id(),record_rev:id()}
  return {...state,[table]:[...state[table].filter(r=>r[pk]!==stored[pk]),stored]}
}
export function projection(state, date=today(), fixed=null) {
  const accounts = fixed || active(state.accounts).filter(a=>a.is_active && a.include_total)
  const observations = active(state.observations).filter(o=>o.observed_on<=date).sort((a,b)=>compare(a.observed_on,b.observed_on) || compare(a.recorded_at,b.recorded_at) || compare(a.observation_id,b.observation_id))
  const latest = fold(observations,'account_id')
  const inputs = [...accounts].sort((a,b)=>compare(a.account_id,b.account_id)).map(a=>{
    const o = latest.get(a.account_id)
    return {account_id:a.account_id,balance_category:a.balance_category,observation_id:o?.observation_id ?? null,observed_on:o?.observed_on ?? null,balance_jpy:o?.balance_jpy ?? null}
  })
  const seen = inputs.filter(a=>a.balance_jpy!=null)
  const liquid = total(seen.filter(a=>a.balance_category!=='Term').map(a=>a.balance_jpy))
  const term = total(seen.filter(a=>a.balance_category==='Term').map(a=>a.balance_jpy))
  return {total:seen.length?total([liquid,term]):null,liquid,term,inputs,seen:seen.length,target:inputs.length}
}
export const observationDates = state => [...new Set(active(state.observations).map(o=>o.observed_on))].filter(d=>d<=today()).sort()
export function makeClosing(state,month,note) {
  const date = monthEnd(month)
  check(validMonth(month) && date<today(),'月が終了してから締めを作成できます。')
  const prior=currentClosings(state).find(c=>c.snapshot_date.startsWith(month))
  check(!prior || note,'締めの訂正理由を入力してください。')
  const p=projection(state,date,prior?.inputs || null)
  return {snapshot_date:date,note:note || null,recorded_at:now(),total_balance_jpy:p.total ?? 0,liquid_balance_jpy:p.liquid,term_balance_jpy:p.term,observed_count:p.seen,target_count:p.target,inputs:p.inputs,supersedes_snapshot_id:prior?.snapshot_id ?? null,calculation_version:1}
}
export function closingChanged(state, closing) {
  return Boolean(closing.inputs && canonical(projection(state,closing.snapshot_date,closing.inputs).inputs)!==canonical(closing.inputs))
}
export function control(state) {
  const count = {}, observationTotals = new Map(), billTotals = new Map()
  for (const [title,[table]] of Object.entries(SCHEMA)) count[title]=state[table].length
  const add = (map,key,value) => map.set(key,total([map.get(key) ?? 0,value]))
  for (const o of state.observations) add(observationTotals,obsKey(o),o.balance_jpy)
  for (const b of state.bills) add(billTotals,billKey(b)+'|'+b.payment_status,b.amount_jpy)
  const p=projection(state,observationDates(state).at(-1) || today())
  return {count,observations:Object.fromEntries(observationTotals),bills:Object.fromEntries(billTotals),coverage:[p.seen,p.target],total:p.total,liquid:p.liquid,term:p.term}
}
function serial(value, kind) {
  if (typeof value==='string') {
    check(kind==='date'?validDate(value):kind==='month'?validMonth(value):validInstant(value),'日付の形式を確認してください。')
    return value
  }
  check(typeof value==='number' && Number.isFinite(value),'Sheets の日付値を確認してください。')
  const epoch=Date.UTC(1899,11,30)
  if (kind==='instant') return new Date(epoch+Math.round(value*86400000)-9*3600000).toISOString()
  check(Number.isSafeInteger(value),'日付／月に時刻が含まれています。')
  const iso=new Date(epoch+value*86400000).toISOString()
  if (kind==='month') check(iso.slice(8,10)==='01','請求月・資料月の元セルは月初の日付が必要です。')
  return iso.slice(0,kind==='month'?7:10)
}
export async function importLegacy(source, allowFormulas=false) {
  check(source?.sourceVersion===1 && source.spreadsheetId===SOURCE_ID && source.locale==='ja_JP' && source.timeZone==='Asia/Tokyo' && source.sheets?.length===7,'指定された旧 Google Sheets のスナップショットを選んでください。')
  const state=emptyState(), evidence=[], stable=[], warnings=[]
  for (const [index,[title,[table,pk,...columns]]] of Object.entries(Object.entries(SCHEMA))) {
    const s=source.sheets.find(r=>r.title===title)
    const schema=[pk,...columns]
    check(s?.sheetId===SHEET_IDS[Number(index)] && canonical(s.header)===canonical(schema) && Array.isArray(s.rows) && Array.isArray(s.formulaFindings),title+' のシートIDまたは列順を確認してください。')
    check(!s.formulaFindings.some(f=>f.error),title+' に数式エラーがあります。')
    check(allowFormulas || !s.formulaFindings.length,title+' に数式があります。式と評価値を確認してください。')
    const rows=[...s.rows].sort((a,b)=>a.rowNumber-b.rowNumber)
    check(new Set(rows.map(r=>r.rowNumber)).size===rows.length,title+' に行番号の重複があります。')
    const clean=[]
    for (const row of rows) {
      check(Number.isInteger(row.rowNumber) && row.rowNumber>1 && Array.isArray(row.values) && row.values.length<=schema.length,title+' の行形式または列数が一致しません。')
      if (row.values.every(v=>v==='' || v==null)) continue
      const raw=schema.map((_,i)=>row.values[i]==='' ? null : row.values[i] ?? null)
      check(raw.every(v=>v===null || typeof v==='string' || typeof v==='boolean' || Number.isFinite(v)),title+' '+row.rowNumber+'行に無効なセル値があります。')
      const record=Object.fromEntries(schema.map((key,i)=>{
        let value=raw[i]
        if (value!=null && /^(observed_on|payment_date|paid_on|snapshot_date)$/.test(key)) value=serial(value,'date')
        if (value!=null && /_month$/.test(key)) value=serial(value,'month')
        if (value!=null && /_at$/.test(key)) value=serial(value,'instant')
        return [key==='file_path'?'legacy_file_path':key,value]
      }))
      check(typeof record[pk]==='string' && record[pk].trim(),title+' '+row.rowNumber+'行のIDを確認してください。')
      if (table==='bills') record.reporting_disposition='included'
      if (table==='monthly_closings') record.calculation_version=0
      state[table].push({...record,record_rev:id()})
      clean.push({rowNumber:row.rowNumber,values:raw})
      evidence.push({sheetId:s.sheetId,rowNumber:row.rowNumber,pk:record[pk],sourceHash:await hash(canonical(raw))})
    }
    stable.push({sheetId:s.sheetId,header:s.header,rows:clean,formulaFindings:s.formulaFindings})
  }
  const groups=Object.groupBy(state.bills,billKey)
  for (const rows of Object.values(groups)) if (rows.length>1) {
    rows.forEach(row=>row.reporting_disposition='pending')
    warnings.push('同じカード・請求月の '+rows.length+' 件を要照合にしました。')
  }
  const missing=state.documents.filter(d=>d.legacy_file_path).length
  if (missing) warnings.push('旧資料 '+missing+' 件のファイルは、別途原本を登録できます。')
  const lookup=new Map(Object.entries(SCHEMA).map(([title,[table,pk]])=>[SHEET_IDS[Object.keys(SCHEMA).indexOf(title)],{index:fold(state[table],pk)}]))
  for (const entry of evidence) {
    const {record_rev,...record}=lookup.get(entry.sheetId).index.get(entry.pk)
    entry.recordHash=await hash(canonical(record))
  }
  const sourceFingerprint=await hash(canonical({spreadsheetId:source.spreadsheetId,sheets:stable}))
  const summary=control(validate(state))
  state.migrationHistory.push({sourceFingerprint,importedAt:now(),evidence,summary})
  return {state,sourceFingerprint,summary,warnings}
}
export function mergeStates(base,left,right) {
  const result=emptyState(), conflicts=[]
  for (const [key,pk] of Object.values(SCHEMA)) {
    const a=fold(base[key],pk), b=fold(left[key],pk), c=fold(right[key],pk)
    for (const k of new Set([...a.keys(),...b.keys(),...c.keys()])) {
      const x=a.get(k), y=b.get(k), z=c.get(k)
      const comparable = r=>{ if (!r) return null; const {record_rev,updated_at,drive_file_id,...value}=r; return canonical(value) }
      let chosen
      if (comparable(y)===comparable(z)) chosen=y || z
      else if (comparable(x)===comparable(y)) chosen=z
      else if (comparable(x)===comparable(z)) chosen=y
      else conflicts.push({table:key,id:k,left:y,right:z})
      if (chosen) result[key].push(chosen)
    }
  }
  result.migrationHistory=[...new Map([...left.migrationHistory,...right.migrationHistory].map(x=>[x.sourceFingerprint,x])).values()]
  for (const [table,key,group] of [['observations','observation_id',obsKey],['bills','bill_id',billKey],['monthly_closings','snapshot_id',r=>r.snapshot_date.slice(0,7)]]) {
    const seen=new Set(base[table].map(r=>r[key]))
    const l=left[table].filter(r=>!seen.has(r[key]) && !r.deleted_at)
    const r=right[table].filter(r=>!seen.has(r[key]) && !r.deleted_at)
    for (const first of l) if (r.some(second=>second[key]!==first[key] && group(second)===group(first))) conflicts.push({table,id:group(first),group:true})
  }
  const old=new Set(base.monthly_closings.map(c=>c.snapshot_id))
  for (const closing of currentClosings(result).filter(c=>!old.has(c.snapshot_id) && c.inputs)) {
    if (closingChanged(result,closing)) conflicts.push({table:'monthly_closings',id:closing.snapshot_date,group:true})
  }
  return {result,conflicts}
}

export function demoState() {
  let state=emptyState()
  const accounts=[
    ['jp','ゆうちょ銀行','ゆうちょ銀行','Ordinary',732400],['gmo','GMOあおぞら','GMOあおぞらネット銀行','Ordinary',516800],
    ['mufg','三菱UFJ銀行','三菱UFJ銀行','Ordinary',411300],['seven','セブン銀行','セブン銀行','Ordinary',238100],
    ['pay','PayPay','PayPay','EWallet',62450],['term','定期預金','定期預金','Term',542000],
  ]
  const dates=['2026-04-30','2026-05-31','2026-06-30','2026-07-31','2026-08-31','2026-09-30','2026-10-31','2026-11-15']
  const ratios=[.78,.82,.80,.87,.923,.91,.958,1]
  accounts.forEach(([account_id,account_name,institution_name,balance_category,value],i)=>{
    state=put(state,'accounts',{account_id,account_name,institution_name,balance_category,account_type:account_id==='pay'?'EWallet':'Bank',include_total:true,is_active:true,can_card_debit:i<4,sort_order:i})
    dates.forEach((observed_on,j)=>{
      const balance_jpy=i===5?value:Math.round((value*(ratios[j]+(j===7?0:((j+i)%3-1)*.012)))/50)*50
      state=put(state,'observations',{observation_id:'demo-'+account_id+'-'+j,account_id,observed_on,balance_jpy,recorded_at:observed_on+'T02:00:00.000Z'})
    })
  })
  for (const [card_id,card_name,issuer,default_debit_account_id,amount_jpy,date] of [['rakuten','楽天カード','楽天カード','jp',86400,'2026-11-27'],['epos','エポスカード','エポス','gmo',67200,'2026-11-27'],['visa','Visaカード','Visa','mufg',58200,'2026-11-30']]) {
    state=put(state,'cards',{card_id,card_name,issuer,default_debit_account_id,is_active:true})
    state=put(state,'bills',{bill_id:'bill-'+card_id,card_id,statement_month:'2026-11',payment_date:date,amount_jpy,payment_status:'Confirmed',debit_account_id:default_debit_account_id,paid_on:null,reporting_disposition:'included'})
  }
  for (const [service_name,document_type,bill_id] of [['楽天カード','PDF','bill-rakuten'],['エポスカード','PDF','bill-epos'],['PayPay','CSV',null]]) {
    state=put(state,'documents',{document_month:'2026-11',service_name,document_type,bill_id,legacy_file_path:'2026-11_'+service_name+'.'+document_type.toLowerCase(),recorded_at:'2026-11-15T02:00:00.000Z'})
  }
  return state
}
