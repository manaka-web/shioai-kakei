import http from 'node:http'
import {createReadStream} from 'node:fs'
import {stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {spawn} from 'node:child_process'

const root=fileURLToPath(new URL('../site/',import.meta.url))
const content={'html':'text/html; charset=utf-8','css':'text/css; charset=utf-8','js':'text/javascript; charset=utf-8','webp':'image/webp','svg':'image/svg+xml'}
const port=Number(process.argv.slice(2).find(arg=>arg!=='--open') || 8765)
if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Choose a port from 1024 to 65535.')
const server=http.createServer(async (req,res)=>{
  const address=new URL(req.url,'http://localhost')
  let filename
  try {
    filename=path.resolve(root,'.'+decodeURIComponent(address.pathname==='/'?'/index.html':address.pathname))
    if (!filename.startsWith(root) || !['GET','HEAD'].includes(req.method)) throw Error()
    const info=await stat(filename)
    if (!info.isFile()) throw Error()
    res.writeHead(200,{'Content-Type':content[path.extname(filename).slice(1)] || 'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-store'})
    if(req.method==='HEAD') res.end()
    else createReadStream(filename).pipe(res)
  } catch {res.writeHead(404);res.end('Not found')}
})
server.listen(port,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+port+'/'
  console.log('しおあい家計OS  '+url)
  if (process.platform==='win32' && process.argv.includes('--open')) {
    const child=spawn(process.env.ComSpec || 'cmd.exe',['/d','/c','start','""',url],{windowsHide:true,stdio:'ignore'})
    child.on('error',()=>console.log('ブラウザで上のURLを開いてください。'))
    child.unref()
  }
})
