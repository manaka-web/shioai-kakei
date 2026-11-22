import {active,billKey,cashflowEntries,cashflowSummary,closingChanged,currentClosings,fold,labels,obsKey,observationDates,projection,today,total,yen} from './domain.js'

const iconPaths={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  wallet:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18m-5 4h2"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/>',
  docs:'<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h7M8 13h8m-8 4h6"/>',
  report:'<path d="M3 20h18M6 16v-4m6 4V8m6 8V4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M10 2h4l.6 3 2 .9 2.6-1.7 2.8 2.8-1.7 2.6.9 2 2.8.6v4l-3 .6-.9 2 1.7 2.6-2.8 2.8-2.6-1.7-2 .9-.6 3h-4l-.6-3-2-.9-2.6 1.7L2 21.4l1.7-2.6-.9-2-2.8-.6v-4l3-.6.9-2-1.7-2.6L5 4.2l2.6 1.7 2-.9z" transform="translate(2 0) scale(.83)"/>',
  coin:'<ellipse cx="14" cy="6" rx="6" ry="3"/><path d="M8 6v4c0 1.7 2.7 3 6 3s6-1.3 6-3V6m0 4v4c0 1.7-2.7 3-6 3m6-3v3c0 1.7-2.7 3-6 3h-2"/><ellipse cx="7" cy="14" rx="4" ry="2"/><path d="M3 14v5c0 1.1 1.8 2 4 2s4-.9 4-2v-5m-8 3c0 1.1 1.8 2 4 2s4-.9 4-2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 10h18m-14 5h2m4 0h3"/>',
  pie:'<path d="M11 3a9 9 0 1 0 10 10H11z"/><path d="M15 3v6h6a8 8 0 0 0-6-6z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  more:'<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  cross:'<path d="m6 6 12 12M18 6 6 18"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  sync:'<path d="M20 8a8 8 0 0 0-13-3L4 8m0-4v4h4m-4 8a8 8 0 0 0 13 3l3-3m-4 0h4v4"/>',
}
export const icon=name=>'<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+iconPaths[name]+'</svg>'
export const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])
export const button=(label,action,{variant='secondary',symbol='',target=''}={})=>'<button type="button" class="button '+variant+'" data-action="'+esc(action)+'" data-id="'+esc(target)+'">'+(symbol?icon(symbol):'')+esc(label)+'</button>'
export const link=(label,route)=>'<a class="text-link" href="#'+route+'">'+esc(label)+icon('arrow')+'</a>'
export const empty=text=>'<p class="empty">'+esc(text)+'</p>'
export const note=(text,warn=false)=>'<p class="notice'+(warn?' warning':'')+'">'+esc(text)+'</p>'
export const badge=(type,text=labels[type] || type)=>'<span class="badge" data-kind="'+esc(type)+'">'+esc(text)+'</span>'
export const shortDate=d=>d?d.slice(5,10).replace('-','/'):'—'
export const labelDate=d=>d?d.replaceAll('-','/'):'—'
const navs=[
  ['home','home','ホーム'],['cashflow','sync','収支','収入・支出・振替'],['observations','wallet','観測点','口座・サービス'],['bills','card','カード請求'],
  ['documents','docs','観測資料','PDF・CSV'],['reports','report','レポート'],['settings','settings','設定'],
]
export const names=Object.fromEntries(navs.map(([k,_,label])=>[k,label]))
export function shell(route,status,body,caption='') {
  const nav=(key,kind,label,hint)=>'<a href="#'+key+'" '+(key===route || key==='settings'&&kind==='more'&&['reports','documents'].includes(route)?'aria-current="page"':'')+'>'+icon(kind)+'<span>'+esc(label)+(hint?'<small>'+esc(hint)+'</small>':'')+'</span></a>'
  const asset=new URL('../assets/compass.svg',import.meta.url).href
  return '<header class="masthead"><div class="mast-inner"><div><div class="brand-lockup"><img class="brand-compass" src="'+asset+'" alt=""><h1 class="mast-title">しおあい家計OS</h1></div><p class="mast-caption">家計を定点観測する。</p><div class="mast-line"></div><p class="mast-note">'+esc(caption || '暮らしの、小さな観測所。')+'</p></div><a href="#settings" class="status" data-kind="'+esc(status.kind)+'">'+esc(status.text)+'</a></div></header>'+
  '<div class="workspace"><aside class="sidebar"><a class="side-brand" href="#home"><img src="'+asset+'" alt="">しおあい家計OS</a><nav class="nav" aria-label="メインメニュー">'+navs.map(x=>nav(...x)).join('')+'</nav><div class="side-footer">暮らしの、<br>小さな観測所。<span>SHIOAI OBSERVATORY</span></div></aside><main class="surface" id="main">'+body+'</main></div>'+
  '<footer class="foot"><b>SHIOAI HOUSEHOLD OBSERVATORY</b><span>日本時間 · 日本円（JPY）</span></footer>'+
  '<nav class="mobile-nav" aria-label="モバイルメニュー">'+navs.slice(0,4).map(([k,i,l])=>nav(k,i,k==='bills'?'カード':k==='documents'?'資料':l)).join('')+nav('settings','more','その他')+'</nav>'
}
export const section=(title,description,actions='')=>'<header class="sectionbar"><div><h2 class="page-title">'+esc(title)+'</h2>'+(description?'<p class="page-caption">'+esc(description)+'</p>':'')+'</div><div class="page-actions">'+actions+'</div></header>'
const panel=(title,symbol,extra,body)=>'<section class="panel"><div class="panel-head"><h3 class="panel-title">'+icon(symbol)+esc(title)+'</h3>'+extra+'</div>'+body+'</section>'
export function table(headers,rows) {
  if (!rows.length) return empty('表示できる記録がありません。')
  return '<div class="scroll-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>Array.isArray(c)?'<td class="num">'+c[0]+'</td>':'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'
}
const avatars=['ゆ','GMO','MU','7','P','定']
const listRow=(r,i)=>'<li><button type="button" class="row-link" data-action="'+r.action+'" data-id="'+esc(r.id)+'"><span class="avatar" data-color="'+(i%5)+'">'+esc(r.avatar)+'</span><span class="row-name">'+esc(r.name)+'</span><span class="row-money">'+esc(r.money)+'</span>'+(r.line?'<canvas class="mini-chart" aria-hidden="true" data-values="'+esc(JSON.stringify(r.line))+'"></canvas>':'<span class="row-detail hide-mid">'+esc(r.detail)+'</span>')+icon('chevron')+'</button></li>'
const list=rows=>rows.length?'<ul class="data-list">'+rows.map(listRow).join('')+'</ul>':empty('まだ記録がありません。')
const kpi=(i,title,value,desc,color='',date=false)=>'<article class="kpi '+color+'"><p class="kpi-top"><span class="kpi-icon">'+icon(i)+'</span>'+esc(title)+'</p><p class="kpi-value'+(date?' date':'')+'">'+esc(value)+'</p><p class="kpi-note">'+esc(desc)+'</p></article>'
export function sortedAccounts(state) {
  return active(state.accounts).sort((a,b)=>(a.sort_order ?? 9999)-(b.sort_order ?? 9999) || a.account_name.localeCompare(b.account_name,'ja'))
}
export function chartData(state,range) {
  const closings=fold(currentClosings(state),'snapshot_date')
  const dates=[...new Set([...observationDates(state),...closings.keys()])].sort()
  const final=new Date((dates.at(-1) || today())+'T00:00:00Z')
  const first=new Date(Date.UTC(final.getUTCFullYear(),final.getUTCMonth()-Number(range)+1,1)).toISOString().slice(0,10)
  return dates.filter(d=>range==='0' || d>=first).map(d=>({d,v:closings.has(d)?closings.get(d).observed_count?closings.get(d).total_balance_jpy:null:projection(state,d).total})).filter(p=>p.v!=null)
}
const chartPanel=(state,range)=>panel('残高推移','report','<div class="segments" aria-label="表示期間">'+[['6','6か月'],['12','1年'],['0','全期間']].map(([v,l])=>'<button type="button" data-action="range" data-id="'+v+'" aria-pressed="'+(range===v)+'">'+l+'</button>').join('')+'</div>',chartData(state,range).length?'<div class="chart-wrap"><canvas id="balance-chart" class="chart" role="img" aria-label="観測時点の総残高の推移"></canvas></div><p class="legend">総残高</p>':empty('残高を観測すると推移が表示されます。'))
export const monthPicker=month=>'<div class="month-picker"><button type="button" class="button ghost" data-action="month-step" data-id="-1" aria-label="前の月">‹</button><label><span class="sr">収支の対象月</span><input aria-label="収支の対象月" type="month" data-month value="'+esc(month)+'" required></label><button type="button" class="button ghost" data-action="month-step" data-id="1" aria-label="次の月">›</button>'+button('今月','month-today',{variant:'ghost'})+'</div>'
const signed=value=>(value<0?'−':'+')+yen(Math.abs(value))
export function flowList(state,entries) {
  const accounts=fold(state.accounts,'account_id')
  return entries.length?'<ul class="flow-list">'+entries.map(x=>'<li><button type="button" class="flow-row" data-action="'+(x.source==='bill'?'bill':'transaction')+'" data-id="'+esc(x.source_id)+'"><span class="flow-symbol '+x.kind+'" aria-hidden="true">'+(x.kind==='income'?'↙':x.kind==='expense'?'↗':'⇄')+'</span><span class="flow-main"><strong>'+esc(x.title)+'</strong><small>'+esc(shortDate(x.occurred_on)+' · '+(accounts.get(x.account_id)?.account_name || '')+(x.kind==='transfer'?' → '+(accounts.get(x.to_account_id)?.account_name || ''):'')+(x.category?' · '+x.category:''))+'</small></span><span class="flow-amount '+x.kind+'">'+esc(x.kind==='transfer'?yen(x.amount_jpy):signed(x.kind==='income'?x.amount_jpy:-x.amount_jpy))+'<small>'+esc(x.status==='posted'?(x.kind==='income'?'入金済':x.kind==='expense'?'支払済':'振替済'):(x.estimated?'見込':'予定'))+(x.source==='bill'?' · カード':'')+'</small></span>'+icon('chevron')+'</button></li>').join('')+'</ul>':empty('この月の収支はまだありません。給与や支払いを登録してみましょう。')
}
export function flowMonths(state,month) {
  const end=new Date(month+'-01T00:00:00Z')
  return Array.from({length:6},(_,i)=>{
    const date=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()-5+i,1)),ym=date.toISOString().slice(0,7)
    return {month:ym,...cashflowSummary(state,ym)}
  })
}
const flowChartPanel=(state,month)=>panel('収入と支出の流れ','report',link('収支を確認','cashflow'),'<div class="chart-wrap"><canvas id="flow-chart" data-month="'+esc(month)+'" class="chart" role="img" aria-label="'+esc(flowMonths(state,month).map(x=>x.month+' 収入'+yen(x.income)+' 支出'+yen(x.expense)).join('、'))+'"></canvas></div><p class="flow-legend"><span>収入</span><span>支出</span><small>入出金済みのみ · 直近6か月</small></p>')
const flowNotice=flow=>flow.unresolved?note('要照合のカード請求 '+flow.unresolved+' 件は収支・予定額に含めていません。カード請求で照合してください。',true):''
export function homeView(state,range,month=today().slice(0,7)) {
  const date=observationDates(state).at(-1),current=projection(state),flow=cashflowSummary(state,month)
  const points=fold(projection(state,today(),sortedAccounts(state)).inputs,'account_id')
  const summary='<div class="kpi-grid cashflow-kpis">'+kpi('coin','現在の総残高',yen(current.total),'最終観測 '+labelDate(date)+' · '+current.seen+' / '+current.target+' 口座')+kpi('report',Number(month.slice(5))+'月の収入',yen(flow.income),'入金済み · 入金予定 '+yen(flow.plannedIncome),'green')+kpi('card',Number(month.slice(5))+'月の支出',yen(flow.expense),'支払済み · 支払予定 '+yen(flow.plannedExpense),'rose')+'</div>'
  const accountRows=sortedAccounts(state).filter(a=>a.is_active).slice(0,5).map((a,i)=>({id:a.account_id,action:'obs-history',avatar:avatars[i] || a.account_name[0],name:a.account_name,money:yen(points.get(a.account_id)?.balance_jpy),line:active(state.observations).filter(o=>o.account_id===a.account_id).sort((x,y)=>x.observed_on.localeCompare(y.observed_on)).slice(-10).map(o=>o.balance_jpy)}))
  const overview=active(state.home)[0]?.overview_note
  return section('ホーム','暮らしの収支と、いまの残高を観測。',button('残高を記録','observation',{symbol:'plus',variant:'primary'}))+
    '<div class="flow-toolbar">'+monthPicker(month)+'<div class="flow-shortcuts">'+button('収入を登録','income',{symbol:'plus'})+button('支出を登録','expense',{symbol:'plus'})+'</div></div>'+summary+
    '<div class="flow-summary"><span>'+esc(Number(month.slice(5))+'月の収支差額')+' <strong class="'+(flow.net>=0?'positive':'negative')+'">'+esc(signed(flow.net))+'</strong></span><span>総残高は口座の観測値です。収支登録による自動増減はありません。</span></div>'+flowNotice(flow)+
    '<div class="dash-grid">'+flowChartPanel(state,month)+panel('この月の収支','sync',link('すべて見る','cashflow'),flowList(state,cashflowEntries(state,month).slice(0,5)))+chartPanel(state,range)+panel('口座ごとの残高','coin',link('観測点へ','observations'),list(accountRows))+'</div>'+
    (overview?'<details class="home-memo"><summary>家計の観測メモ</summary><p>'+esc(overview)+'</p></details>':'')
}
export function cashflowView(state,month=today().slice(0,7),filter='all') {
  const flow=cashflowSummary(state,month),entries=cashflowEntries(state,month)
  const filtered=entries.filter(x=>filter==='all' || (filter==='planned'?x.status==='planned':x.kind===filter))
  return section('収支','お金が入った日・出た日で、暮らしの流れを記録。',button('収入を登録','income',{symbol:'plus'})+button('支出を登録','expense',{symbol:'plus',variant:'primary'}))+
    '<div class="flow-toolbar">'+monthPicker(month)+button('口座間の振替','transfer',{symbol:'sync'})+'</div>'+
    '<div class="kpi-grid cashflow-kpis ledger-kpis">'+kpi('report','入金済み',yen(flow.income),'入金予定 '+yen(flow.plannedIncome),'green')+kpi('card','支払済み',yen(flow.expense),'支払予定 '+yen(flow.plannedExpense),'rose')+kpi('pie','収支差額',signed(flow.net),'口座間の振替は集計対象外')+'</div>'+flowNotice(flow)+
    note('カードは「支払済」にすると支払日で支出へ反映します。カードの利用明細は重ねて登録せず、現金・振込・口座振替などを追加してください。')+
    panel('収支の記録','sync','<div class="flow-filters" aria-label="収支の絞り込み">'+[['all','すべて'],['income','収入'],['expense','支出'],['transfer','振替'],['planned','予定']].map(([v,l])=>'<button type="button" data-action="flow-filter" data-id="'+v+'" aria-pressed="'+(filter===v)+'">'+l+'</button>').join('')+'</div>',flowList(state,filtered))
}
export function observationsView(state) {
  const accounts=sortedAccounts(state), account=fold(accounts,'account_id'), balances=fold(projection(state,today(),accounts).inputs,'account_id')
  const rows=accounts.map(a=>[esc(a.account_name),esc(labels[a.balance_category]),a.is_active?badge(a.include_total?'集計対象':'集計対象外'):badge('無効'),[esc(yen(balances.get(a.account_id)?.balance_jpy))],esc(labelDate(balances.get(a.account_id)?.observed_on)),button('履歴','obs-history',{target:a.account_id,variant:'ghost'})+button('編集','account',{target:a.account_id,variant:'ghost'})])
  const recent=[...active(state.observations)].sort((a,b)=>b.observed_on.localeCompare(a.observed_on) || b.recorded_at.localeCompare(a.recorded_at)).slice(0,20)
  const duplicates=Object.groupBy(active(state.observations),obsKey)
  const obsRows=recent.map(o=>[esc(labelDate(o.observed_on)),esc(account.get(o.account_id).account_name),[esc(yen(o.balance_jpy))],duplicates[obsKey(o)].length>1?badge('pending','同日複数'):esc(o.note),button('編集','observation',{target:o.observation_id,variant:'ghost'})])
  return section('観測点','日付と残高を記録し、口座ごとの変化を確認します。',button('口座を追加','account',{symbol:'plus'})+button('今回の観測を記録','observation',{symbol:'plus',variant:'primary'}))+
    '<div class="content-stack">'+panel('口座・サービス','wallet','',table(['口座名','区分','状態','最新残高','採用日','操作'],rows))+panel('観測履歴','clock','',table(['観測日','口座','残高','メモ','操作'],obsRows))+'</div>'
}
export function billsView(state) {
  const accounts=fold(state.accounts,'account_id'),cards=fold(state.cards,'card_id')
  const bills=active(state.bills).sort((a,b)=>b.statement_month.localeCompare(a.statement_month) || a.payment_date.localeCompare(b.payment_date))
  const pending=Object.entries(Object.groupBy(bills.filter(b=>b.reporting_disposition==='pending'),billKey))
  const notice=pending.map(([key,rows])=>'<div class="notice warning">'+esc(cards.get(rows[0].card_id).card_name)+' '+esc(rows[0].statement_month)+' · '+rows.length+' 件の候補 '+button('照合する','bill-review',{target:key,variant:'ghost'})+'</div>').join('')
  const billRows=bills.map(b=>[esc(cards.get(b.card_id).card_name),esc(b.statement_month),esc(labelDate(b.payment_date)),[esc(yen(b.amount_jpy))],badge(b.payment_status)+(b.reporting_disposition==='included'?'':' '+badge(b.reporting_disposition)),esc(accounts.get(b.debit_account_id).account_name),button('編集','bill',{target:b.bill_id,variant:'ghost'})])
  const cardRows=active(state.cards).map(c=>[esc(c.card_name),esc(c.issuer || '—'),esc(accounts.get(c.default_debit_account_id)?.account_name || '—'),badge(c.is_active?'有効':'無効'),button('編集','card',{target:c.card_id,variant:'ghost'})])
  return section('カード請求','支払予定と引落口座を確認します。',button('カードを追加','card',{symbol:'plus'})+button('請求を登録','bill',{symbol:'plus',variant:'primary'}))+
    notice+'<div class="content-stack">'+panel('請求一覧','card','',table(['カード','請求月','引落日','金額','状態','引落口座','操作'],billRows))+panel('カード設定','settings','',table(['カード','発行会社','既定の引落口座','状態','操作'],cardRows))+'</div>'
}
export function docsView(state) {
  const bills=fold(state.bills,'bill_id')
  const cards=fold(state.cards,'card_id')
  const rows=active(state.documents).sort((a,b)=>b.document_month.localeCompare(a.document_month)).map(d=>{
    const bill=bills.get(d.bill_id)
    return [esc(d.document_month),esc(d.file_name || d.service_name),badge(d.document_type),esc(bill?cards.get(bill.card_id)?.card_name+' '+bill.statement_month:'—'),d.blob_id?button('ダウンロード','file',{target:d.document_id,variant:'ghost'}):badge('pending','原本未登録'),button('編集','document',{target:d.document_id,variant:'ghost'})]
  })
  return section('観測資料','PDF・CSVを登録し、カード請求と結び付けます。',button('資料を追加','document',{symbol:'plus',variant:'primary'}))+panel('資料一覧','docs','',table(['対象月','ファイル・サービス','種類','請求','原本','操作'],rows))
}
export function reportsView(state,range,month=today().slice(0,7)) {
  const current=new Set(currentClosings(state).map(c=>c.snapshot_id))
  const closings=[...active(state.monthly_closings)].sort((a,b)=>b.snapshot_date.localeCompare(a.snapshot_date) || b.recorded_at.localeCompare(a.recorded_at))
  const rows=closings.map(c=>[esc(labelDate(c.snapshot_date)),[esc(yen(c.total_balance_jpy))],[esc(yen(c.income_jpy))],[esc(yen(c.expense_jpy))],esc(c.observed_count+' / '+c.target_count),current.has(c.snapshot_id)?closingChanged(state,c)?badge('pending','訂正要確認'):badge(c.inputs?'確定':'旧締め') :badge('訂正前'),button('詳細','closing-view',{target:c.snapshot_id,variant:'ghost'})])
  const monthly=flowMonths(state,month).reverse().map(x=>[esc(x.month),[esc(yen(x.income))],[esc(yen(x.expense))],[esc(signed(x.net))],x.unresolved?badge('pending',x.unresolved+'件 要照合'):esc('—')])
  return section('レポート','月ごとの収支と、確定した残高を振り返ります。',button('月次締めを作成','closing',{symbol:'plus',variant:'primary'}))+
    '<div class="flow-toolbar">'+monthPicker(month)+'</div><div class="content-stack">'+flowChartPanel(state,month)+panel('月ごとの収支','calendar','',table(['対象月','収入','支出','差額','照合待ち'],monthly))+chartPanel(state,range)+panel('月次締め','calendar','',table(['対象日','総残高','収入','支出','観測口座','状態','操作'],rows))+'</div>'
}

function context(canvas) {
  const w=canvas.clientWidth,h=canvas.clientHeight
  if (!w || !h) return null
  const dpr=Math.min(2,window.devicePixelRatio || 1)
  canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr)
  const c=canvas.getContext('2d')
  c.scale(dpr,dpr)
  return {c,w,h}
}
export function drawCharts(state,range) {
  const chart=document.getElementById('balance-chart')
  const data=chart?chartData(state,range):[]
  const env=chart?context(chart):null
  if (env && data.length) {
    const {c,w,h}=env
    const left=51,right=w-12,top=15,bottom=h-28
    const values=data.map(p=>p.v), displayRange=Math.max(10000,Math.max(...values)-Math.min(...values))
    const raw=displayRange/3,power=10**Math.floor(Math.log10(raw)),unit=[1,2,5,10].find(x=>x*power>=raw)*power
    const low=Math.floor((Math.min(...values)-unit*.23)/unit)*unit,high=Math.ceil((Math.max(...values)+unit*.22)/unit)*unit
    const xs=(i)=>data.length===1?(left+right)/2:left+(right-left)*i/(data.length-1)
    const ys=v=>bottom-(bottom-top)*(v-low)/(high-low)
    c.font='11px system-ui'; c.textBaseline='middle'; c.lineWidth=1
    for(let v=low;v<=high;v+=unit) {
      const y=ys(v)
      c.strokeStyle='#e2e9f1'; c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke()
      c.fillStyle='#596d84'; c.textAlign='right';c.fillText((v/10000).toLocaleString('ja-JP',{maximumFractionDigits:1})+'万',left-8,y)
    }
    const labelEvery=Math.max(1,Math.ceil(data.length/Math.max(2,Math.floor((w-52)/48))))
    data.forEach((p,i)=>{
      if(i%labelEvery && i!==data.length-1) return
      if(i!==data.length-1 && data.length-1-i<labelEvery/2) return
      const x=xs(i)
      c.strokeStyle='#e9eef4';c.beginPath();c.moveTo(x,top);c.lineTo(x,bottom);c.stroke()
      c.textAlign=i===data.length-1?'right':'center';c.fillStyle='#596d84';c.fillText(Number(p.d.slice(5,7))+'月'+Number(p.d.slice(8))+'日',x,bottom+15)
    })
    c.beginPath();data.forEach((p,i)=>i?c.lineTo(xs(i),ys(p.v)):c.moveTo(xs(i),ys(p.v)))
    if (data.length>1) {
      c.lineTo(xs(data.length-1),bottom);c.lineTo(xs(0),bottom);c.closePath()
      const gradient=c.createLinearGradient(0,top,0,bottom)
      gradient.addColorStop(0,'#d8eaff');gradient.addColorStop(1,'#f5faff')
      c.fillStyle=gradient;c.fill()
    }
    c.strokeStyle='#28639e';c.lineWidth=2.1;c.beginPath()
    data.forEach((p,i)=>i?c.lineTo(xs(i),ys(p.v)):c.moveTo(xs(i),ys(p.v)));c.stroke()
    data.forEach((p,i)=>{if (data.length>40 && i%labelEvery) return;c.fillStyle='#2a649e';c.beginPath();c.arc(xs(i),ys(p.v),3.5,0,2*Math.PI);c.fill();c.strokeStyle='white';c.lineWidth=1;c.stroke()})
    chart.setAttribute('aria-label','総残高の推移。'+data[0].d+' '+yen(data[0].v)+'、最新 '+data.at(-1).d+' '+yen(data.at(-1).v))
  }
  const flowChart=document.getElementById('flow-chart')
  const flowEnv=flowChart?context(flowChart):null
  if (flowEnv) {
    const {c,w,h}=flowEnv,data=flowMonths(state,flowChart.dataset.month)
    const left=49,right=w-10,top=14,bottom=h-27
    const values=data.flatMap(x=>[x.income,x.expense]),high=Math.max(10000,...values),low=Math.min(0,...values)
    const ys=v=>bottom-(bottom-top)*(v-low)/(high-low),zero=ys(0),step=(right-left)/data.length
    c.font='11px system-ui';c.lineWidth=1
    for(let i=0;i<=3;i++) {
      const value=low+(high-low)*i/3,y=ys(value)
      c.strokeStyle='#e5ecf2';c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke()
      c.fillStyle='#596d84';c.textAlign='right';c.fillText((value/10000).toLocaleString('ja-JP',{maximumFractionDigits:1})+'万',left-6,y+3)
    }
    data.forEach((x,i)=>{
      const center=left+step*(i+.5),bar=Math.min(20,step*.28)
      for(const [index,key,color] of [[0,'income','#397f70'],[1,'expense','#bb7380']]) {
        const y=ys(x[key]);c.fillStyle=color;c.fillRect(center+(index?2:-bar-2),Math.min(y,zero),bar,Math.max(1,Math.abs(zero-y)))
      }
      c.fillStyle='#596d84';c.textAlign='center';c.fillText(Number(x.month.slice(5))+'月',center,bottom+17)
    })
  }
  for (const spark of document.querySelectorAll('.mini-chart')) {
    const data=JSON.parse(spark.dataset.values),env=context(spark)
    if (!env || data.length<2) continue
    const {c,w,h}=env
    const low=Math.min(...data),span=Math.max(1,Math.max(...data)-low)
    c.strokeStyle='#297f74';c.lineWidth=1.4;c.beginPath()
    data.forEach((v,i)=>{const x=2+i*(w-4)/(data.length-1),y=h-3-(h-6)*(v-low)/span;i?c.lineTo(x,y):c.moveTo(x,y)})
    c.stroke()
  }
}
