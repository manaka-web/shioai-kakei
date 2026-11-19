import http from 'node:http'
import {createHash,createHmac,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto'

const scope='https://www.googleapis.com/auth/drive.appdata'
const {GOOGLE_CLIENT_ID:clientId,GOOGLE_CLIENT_SECRET:clientSecret,SHIOAI_WEB_ORIGIN:allowOrigin,SHIOAI_REDIRECT_URI:redirectUri,SHIOAI_STATE_KEY:stateSecret,PORT='8080'}=process.env
if (!clientId || !clientSecret || !allowOrigin || !redirectUri || !stateSecret || Buffer.from(stateSecret,'base64url').length<32) throw new Error('OAuth configuration is incomplete.')
if (new URL(redirectUri).origin!==allowOrigin || new URL(redirectUri).protocol!=='https:') throw new Error('OAuth redirect URI and allowed origin must match.')

const urlSafe=/^[A-Za-z0-9_-]+$/
const challengeFor=verifier=>createHash('sha256').update(verifier).digest('base64url')
const mac=value=>createHmac('sha256',Buffer.from(stateSecret,'base64url')).update(value).digest()
const nonce=()=>randomBytes(32).toString('base64url')
const equal=(a,b)=>a.length===b.length && timingSafeEqual(a,b)
const isGoodChallenge=v=>typeof v==='string' && v.length===43 && urlSafe.test(v)
const epoch=()=>Math.floor(Date.now()/1000)
let jwks={keys:[],expires:0}
async function googleKey(kid,force=false) {
  if (!force && jwks.expires>Date.now()) return jwks.keys.find(k=>k.kid===kid)
  const result=await fetch('https://www.googleapis.com/oauth2/v3/certs',{signal:AbortSignal.timeout(8000)})
  if (!result.ok) throw new Error('verification unavailable')
  const ttl=Number(/max-age=(\d+)/.exec(result.headers.get('cache-control') || '')?.[1] || 300)
  jwks={keys:(await result.json()).keys,expires:Date.now()+ttl*1000}
  return jwks.keys.find(k=>k.kid===kid)
}
async function verifyGoogle(jwt,expectedNonce,accessToken) {
  const [h,p,s,...extra]=(jwt || '').split('.')
  if (extra.length || ![h,p,s].every(x=>urlSafe.test(x || ''))) throw new Error('invalid token')
  const header=JSON.parse(Buffer.from(h,'base64url')),claims=JSON.parse(Buffer.from(p,'base64url'))
  if (header.alg!=='RS256' || !header.kid) throw new Error('invalid token')
  const key=await googleKey(header.kid) || await googleKey(header.kid,true)
  if (!key || !verify('RSA-SHA256',Buffer.from(h+'.'+p),createPublicKey({key,format:'jwk'}),Buffer.from(s,'base64url'))) throw new Error('invalid signature')
  if (!['accounts.google.com','https://accounts.google.com'].includes(claims.iss) || claims.aud!==clientId || claims.azp && claims.azp!==clientId || !Number.isInteger(claims.exp) || claims.exp<=epoch() || Number(claims.iat)>epoch()+120 || claims.nonce!==expectedNonce || !claims.sub) throw new Error('invalid claims')
  if (claims.at_hash && claims.at_hash!==createHash('sha256').update(accessToken).digest().subarray(0,16).toString('base64url')) throw new Error('invalid access token hash')
  return claims.sub
}
async function jsonBody(req) {
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('invalid type')
  const chunks=[]
  let length=0
  for await (const chunk of req) {
    length+=chunk.length
    if (length>12000) throw new Error('invalid size')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function start({challenge}) {
  if (!isGoodChallenge(challenge)) throw new Error('invalid challenge')
  const flow={id:nonce(),nonce:nonce(),challenge,exp:epoch()+600}
  const body=Buffer.from(JSON.stringify(flow)).toString('base64url')
  const state=body+'.'+mac(body).toString('base64url')
  const query=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid '+scope,access_type:'online',state,nonce:flow.nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'})
  return {url:'https://accounts.google.com/o/oauth2/v2/auth?'+query,state}
}
async function exchange({code,state,codeVerifier}) {
  if (typeof code!=='string' || !code || code.length>3000 || typeof state!=='string' || state.length>2000 || !isGoodChallenge(codeVerifier)) throw new Error('invalid exchange')
  const [body,signature,...extra]=state.split('.')
  if (extra.length || !urlSafe.test(body || '') || !urlSafe.test(signature || '') || !equal(mac(body),Buffer.from(signature,'base64url'))) throw new Error('invalid state')
  const flow=JSON.parse(Buffer.from(body,'base64url'))
  if (flow.exp<epoch() || flow.challenge!==challengeFor(codeVerifier)) throw new Error('invalid verifier')
  const bodyParams=new URLSearchParams({code,grant_type:'authorization_code',client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,code_verifier:codeVerifier})
  const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:bodyParams,signal:AbortSignal.timeout(12000),redirect:'error'})
  if (!result.ok) throw new Error('code exchange failed')
  const token=await result.json()
  if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in<=10 || !token.scope?.split(' ').includes(scope)) throw new Error('drive scope missing')
  const sub=await verifyGoogle(token.id_token,flow.nonce,token.access_token)
  return {accessToken:token.access_token,expiresAt:Date.now()+token.expires_in*1000,sub}
}

const attempts=new Map()
function allowed(req) {
  const stamp=Math.floor(Date.now()/60000),address=req.socket.remoteAddress || ''
  for (const [key,value] of attempts) if (value.stamp!==stamp) attempts.delete(key)
  if (!attempts.has(address) && attempts.size>=2000) return false
  const entry=attempts.get(address) || {stamp,count:0}
  entry.count++
  attempts.set(address,entry)
  return entry.count<=80
}
http.createServer(async (req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('Referrer-Policy','no-referrer')
  const methods={'/oauth/start':start,'/oauth/exchange':exchange}
  const fn=methods[req.url]
  if (!Object.hasOwn(methods,req.url) || req.headers.origin!==allowOrigin) {res.writeHead(404);res.end();return}
  res.setHeader('Access-Control-Allow-Origin',allowOrigin)
  res.setHeader('Vary','Origin')
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers','Content-Type')
  if (req.method==='OPTIONS') {res.writeHead(204);res.end();return}
  if (req.method!=='POST') {res.writeHead(405);res.end();return}
  if (!allowed(req)) {res.writeHead(429,{'Retry-After':'60'});res.end();return}
  res.setHeader('Content-Type','application/json; charset=utf-8')
  try {res.end(JSON.stringify(await fn(await jsonBody(req))))}
  catch {res.statusCode=400;res.end('{"error":"oauth_request_failed"}')}
}).listen(Number(PORT),'0.0.0.0')
