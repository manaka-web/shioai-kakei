import http from 'node:http'
import {readFile,writeFile} from 'node:fs/promises'
import {randomBytes,createHash} from 'node:crypto'
import {SCHEMA,SOURCE_ID,SHEET_IDS,canonical,check,importLegacy} from '../site/js/domain.js'

const scope='https://www.googleapis.com/auth/spreadsheets.readonly'
const api='https://sheets.googleapis.com/v4/spreadsheets/'+SOURCE_ID
const argv=process.argv.slice(2)
if (argv.length!==2 || argv.includes('--help')) {
  console.log('Usage: node tools/read-legacy.mjs <desktop-oauth-client.json> <output-snapshot.json>')
  process.exit(argv.includes('--help')?0:1)
}

async function authorize(credentials) {
  check(credentials?.client_id,'Google Cloud のデスクトップ OAuth クライアント JSON を指定してください。')
  const verifier=randomBytes(32).toString('base64url')
  const state=randomBytes(32).toString('base64url')
  const server=http.createServer()
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok)})
  const redirect='http://127.0.0.1:'+server.address().port+'/'
  const params=new URLSearchParams({client_id:credentials.client_id,redirect_uri:redirect,response_type:'code',scope,state,access_type:'online',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')})
  console.log('ブラウザで下のURLを開き、旧シートの読み取りを許可してください。')
  console.log('https://accounts.google.com/o/oauth2/v2/auth?'+params)
  const code=await new Promise((ok,fail)=>{
    const timeout=setTimeout(()=>{server.close();fail(new Error('認証が時間切れになりました。'))},5*60*1000)
    server.on('request',(req,res)=>{
      const url=new URL(req.url,redirect)
      if (url.pathname!=='/' || url.searchParams.get('state')!==state) {res.writeHead(404);res.end();return}
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
      res.end('操作を端末のウィンドウで確認してください。')
      clearTimeout(timeout)
      server.close()
      if (url.searchParams.has('code')) ok(url.searchParams.get('code'))
      else fail(new Error('Google の読み取り認証が中止されました。'))
    })
  })
  const args=new URLSearchParams({client_id:credentials.client_id,redirect_uri:redirect,grant_type:'authorization_code',code,code_verifier:verifier})
  if (credentials.client_secret) args.set('client_secret',credentials.client_secret)
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:args,redirect:'error',signal:AbortSignal.timeout(15000)})
  check(res.ok,'Google の認可コードを確認できませんでした。')
  const result=await res.json()
  check(result.access_token && result.scope?.split(' ').includes(scope),'読み取り専用スコープを取得できませんでした。')
  return result.access_token
}
function column(n) {
  let result=''
  for (;n>0;n=Math.floor((n-1)/26)) result=String.fromCharCode(65+(n-1)%26)+result
  return result
}
const raw=cell=>cell?.effectiveValue?.numberValue ?? cell?.effectiveValue?.boolValue ?? cell?.effectiveValue?.stringValue ?? null
async function read(token) {
  async function get(args) {
    const response=await fetch(api+'?'+args,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000),redirect:'error'})
    check(response.ok,'旧シートを読み取れません（'+response.status+'）。')
    return response.json()
  }
  const metadata=await get(new URLSearchParams({fields:'spreadsheetId,properties(locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'}))
  check(metadata.spreadsheetId===SOURCE_ID,'移行元IDが一致しません。')
  const sheets=[]
  for (const [index,title] of Object.keys(SCHEMA).entries()) {
    const props=metadata.sheets.map(s=>s.properties).find(s=>s.title===title && s.sheetId===SHEET_IDS[index])
    check(props?.gridProperties,title+' を確認できません。')
    const sheet={sheetId:props.sheetId,title,header:null,rows:[],formulaFindings:[]}
    const max=props.gridProperties.columnCount, rows=props.gridProperties.rowCount
    const block=Math.max(1,Math.min(500,Math.floor(12000/max)))
    for (let row=1;row<=rows;row+=block) {
      const params=new URLSearchParams({ranges:title+'!A'+row+':'+column(max)+Math.min(row+block-1,rows),fields:'sheets(data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue))))'})
      const data=(await get(params)).sheets?.[0]?.data?.[0]
      for (const [offset,line] of (data?.rowData || []).entries()) {
        const rowNumber=(data.startRow || 0)+offset+1
        const cells=line.values || []
        const values=cells.map(raw)
        while (values.length && (values.at(-1)===null || values.at(-1)==='')) values.pop()
        for (const [i,cell] of cells.entries()) if (cell.userEnteredValue?.formulaValue || cell.effectiveValue?.errorValue) {
          sheet.formulaFindings.push({cell:column(i+1)+rowNumber,formula:cell.userEnteredValue?.formulaValue ?? null,value:raw(cell),error:cell.effectiveValue?.errorValue?.type ?? null})
        }
        if (rowNumber===1) sheet.header=values
        else if (values.length) sheet.rows.push({rowNumber,values})
      }
    }
    sheets.push(sheet)
  }
  return {sourceVersion:1,spreadsheetId:SOURCE_ID,locale:metadata.properties.locale,timeZone:metadata.properties.timeZone,sheets}
}

try {
  const credentials=JSON.parse(await readFile(argv[0],'utf8'))
  const token=await authorize(credentials.installed)
  const first=await read(token)
  const second=await read(token)
  check(canonical(first)===canonical(second),'取得中にシートが更新されました。もう一度実行してください。')
  await importLegacy(first,true)
  await writeFile(argv[1],canonical({...first,capturedAt:new Date().toISOString()})+'\n',{flag:'wx'})
  console.log('読み取りと照合が完了しました。設定からスナップショットを検証できます。')
} catch(error) {
  console.error(error.message)
  process.exitCode=1
}
