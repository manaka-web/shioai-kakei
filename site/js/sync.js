import {canonical,check,emptyState,hash,id,mergeStates,now,orderState,validate} from './domain.js'
import {asset,open,persist,profileKey,seal,verifyAsset} from './storage.js'

export const initialPacket = state => ({working:state,baseState:emptyState(),base:null,known:[],assetIds:{},pending:null,backup:null})
export class VaultSession {
  constructor(profile,root,packet) {
    this.profile=profile
    this.root=root
    this.packet=packet
    this.commits=new Map()
  }
  static async existing(profile,root){
    const packet=profile.packet ? await open(root,profile.header.datasetId,'local',profile.packet) : initialPacket(emptyState())
    validate(packet.working)
    return new VaultSession(profile,root,packet)
  }
  get state(){return this.packet.working}
  get dataset(){return this.profile.header.datasetId}
  get dirty(){return canonical(orderState(this.packet.working))!==canonical(orderState(this.packet.baseState))}
  async rememberConnection(connection) {
    check(connection?.sub===this.profile.identity && connection.sub.startsWith('dropbox:'+connection.appKey+':dbid:') && typeof connection.refreshToken==='string' && connection.refreshToken.length>0,'保管庫と Dropbox のアカウントが一致しません。')
    const safe={sub:connection.sub,appKey:connection.appKey,refreshToken:connection.refreshToken,accountLabel:connection.accountLabel || 'Dropbox'}
    if (canonical(this.packet.connection ?? null)!==canonical(safe)) await this.update({...this.packet,connection:safe})
  }
  async forgetConnection() {
    await this.update({...this.packet,connection:null})
  }
  async update(next,objects=[],identity=this.profile.identity) {
    const current=this.profile
    const profile={...current,identity,key:profileKey(identity,this.dataset),stamp:id()}
    profile.packet=await seal(this.root,this.dataset,'local',next)
    await persist(profile,current.stamp ?? null,objects,profile.key!==current.key && current.stamp ? current.key : null)
    this.profile=profile
    this.packet=next
  }
  async stage(state,objects=[],reason='save') {
    check(!this.packet.pending,'送信途中の保存があります。同期を再試行してください。')
    validate(state)
    for (const closing of state.monthly_closings.filter(c=>c.inputs && !this.state.monthly_closings.some(o=>o.snapshot_id===c.snapshot_id))) {
      closing.input_hash=await hash(canonical(closing.inputs))
      if (closing.cashflow_inputs) closing.cashflow_hash=await hash(canonical(closing.cashflow_inputs))
    }
    await this.update({...this.packet,working:state,outboxReason:reason!=='save'?reason:this.packet.outboxReason ?? null},objects)
  }
  async document(drive,doc) {
    let packet=await asset(this.dataset,doc.blob_id)
    if (!packet && drive && doc.drive_file_id) packet=await drive.get(doc.drive_file_id)
    return packet
  }
  async graph(drive) {
    check(this.profile.identity===drive.credential.sub,'同じ Dropbox アカウントで再接続してください。')
    if (!this.packet.vaultFile) return {heads:[],byId:new Map()}
    const files=(await drive.list()).filter(f=>f.appProperties?.dataset===this.dataset && f.appProperties?.kind==='commit')
    const revisions=new Map(files.map(f=>[f.id,f.revision]))
    for (const file of files) {
      if (this.commits.get(file.id)?.remoteRevision!==file.revision) this.commits.delete(file.id)
    }
    const marker=await drive.get(this.packet.vaultFile)
    check(canonical(marker.header)===canonical(this.profile.header),'Dropbox の保管庫鍵が一致しません。')
    const {genesis}=await open(this.root,this.dataset,'marker',marker.genesis)
    const byId=new Map(), visiting=new Set(), parentIds=new Set()
    const visit=async(fileId,expected)=>{
      check(!visiting.has(fileId),'Dropbox の版に循環があります。')
      if (byId.has(fileId)) {
        if (expected) check(canonical(byId.get(fileId).ref)===canonical(expected),'親の版ハッシュが一致しません。')
        return
      }
      visiting.add(fileId)
      let commit=this.commits.get(fileId)
      if (!commit) {
        const packet=await drive.get(fileId)
        const payload=await open(this.root,this.dataset,'commit',packet)
        check(([1,2].includes(payload.schemaVersion) && payload.reducerVersion===payload.schemaVersion) && payload.commitId===packet.objectId && Array.isArray(payload.parentRefs),'新しいデータ形式です。家計OSを最新版へ更新してください。')
        validate(payload.state)
        check(payload.stateHash===await hash(canonical(orderState(payload.state))),'Dropbox の状態ハッシュが一致しません。')
        for (const c of payload.state.monthly_closings.filter(c=>c.inputs)) check(c.input_hash===await hash(canonical(c.inputs)),'締めの入力ハッシュが一致しません。')
        for (const c of payload.state.monthly_closings.filter(c=>c.cashflow_inputs)) check(c.cashflow_hash===await hash(canonical(c.cashflow_inputs)),'締めの収支ハッシュが一致しません。')
        commit={...payload,remoteRevision:revisions.get(fileId),ref:{commitId:payload.commitId,driveFileId:fileId,stateHash:payload.stateHash}}
        this.commits.set(fileId,commit)
      }
      if (expected) check(canonical(commit.ref)===canonical(expected),'親の版ハッシュが一致しません。')
      check(commit.parentRefs.length || fileId===genesis.driveFileId,'保管庫に複数の初期版があります。')
      for (const parent of commit.parentRefs) {
        await visit(parent.driveFileId,parent)
        parentIds.add(parent.driveFileId)
      }
      byId.set(fileId,commit)
      visiting.delete(fileId)
    }
    // A known tip missing from a listing is looked up directly, even if cached.
    const listed=new Set(files.map(f=>f.id))
    for (const known of [genesis,...this.packet.known]) {
      if (!listed.has(known.driveFileId)) this.commits.delete(known.driveFileId)
      await visit(known.driveFileId,known)
    }
    for (const f of files) await visit(f.id)
    return {heads:[...byId.values()].filter(c=>!parentIds.has(c.ref.driveFileId)).sort((a,b)=>a.commitId.localeCompare(b.commitId)),byId}
  }
  async prepare(drive,state,parents,reason) {
    const uploadDocs=state.documents.filter(d=>d.blob_id)
    for (const doc of uploadDocs) {
      if (doc.drive_file_id) { await verifyAsset(this.root,this.dataset,doc,await drive.get(doc.drive_file_id)); continue }
      const fileId=this.packet.assetIds[doc.blob_id] || await drive.nextId('blob',this.dataset)
      if (!this.packet.assetIds[doc.blob_id]) await this.update({...this.packet,assetIds:{...this.packet.assetIds,[doc.blob_id]:fileId}})
      const payload=await this.document(drive,doc)
      await verifyAsset(this.root,this.dataset,doc,payload)
      await drive.ensure(fileId,payload,'blob',this.dataset)
    }
    state=orderState(validate({...state,documents:state.documents.map(doc=>doc.blob_id && !doc.drive_file_id?{...doc,drive_file_id:this.packet.assetIds[doc.blob_id]}:doc)}))
    for (const c of state.monthly_closings.filter(c=>c.inputs)) check(c.input_hash===await hash(canonical(c.inputs)),'締めの入力を再確認してください。')
    for (const c of state.monthly_closings.filter(c=>c.cashflow_inputs)) check(c.cashflow_hash===await hash(canonical(c.cashflow_inputs)),'締めの収支を再確認してください。')
    const commitId=id(),stateHash=await hash(canonical(state)),fileId=await drive.nextId('commit',this.dataset)
    const payload={schemaVersion:2,reducerVersion:2,commitId,parentRefs:parents,operationId:id(),deviceId:this.profile.deviceId,createdAt:now(),reason,state,stateHash}
    const envelope=await seal(this.root,this.dataset,'commit',payload,commitId)
    const ref={commitId,driveFileId:fileId,stateHash}
    const newVaultFile=this.packet.vaultFile ? null : await drive.nextId('vault',this.dataset)
    const marker=newVaultFile?{header:this.profile.header,genesis:await seal(this.root,this.dataset,'marker',{genesis:ref})}:null
    await this.update({...this.packet,pending:{fileId,envelope,ref,newVaultFile,marker,state,reason}})
  }
  async send(drive) {
    const pending=this.packet.pending
    await drive.ensure(pending.fileId,pending.envelope,'commit',this.dataset)
    if (pending.newVaultFile) await drive.ensure(pending.newVaultFile,pending.marker,'vault',this.dataset)
    await this.update({...this.packet,pending:null,base:pending.ref,baseState:pending.state,working:pending.state,known:[pending.ref],outboxReason:null,vaultFile:pending.newVaultFile || this.packet.vaultFile,syncedAt:now(),needsBackup:['migration','closing','restore'].includes(pending.reason) || this.packet.needsBackup===true})
  }
  async publish(drive,{reason='save',resolution=null}={}) {
    check(this.profile.identity===drive.credential.sub,'同じ Dropbox アカウントで再接続してください。')
    if (this.packet.pending) await this.send(drive)
    reason=this.packet.outboxReason || reason
    let graph=await this.graph(drive)
    const heads=graph.heads.map(h=>h.ref)
    if (resolution) {
      check(canonical(heads)===canonical(resolution.heads),'確認中に別の保存がありました。差分を読み直してください。')
      await this.prepare(drive,resolution.state,heads,'merge')
      await this.send(drive)
      graph=await this.graph(drive)
    } else if (!this.packet.vaultFile || heads.length===1) {
      const head=graph.heads[0]
      let draft=this.state
      if (head && head.ref.commitId!==this.packet.base?.commitId) {
        if (this.dirty) {
          const merged=mergeStates(this.packet.baseState,draft,head.state)
          try { validate(merged.result) } catch { merged.conflicts.push({id:'制約を満たさない変更'}) }
          if (reason==='restore') merged.conflicts.push({id:'復元確認後に Dropbox が更新されました。'})
          if (merged.conflicts.length) return {graph,conflict:{head,merged,draft}}
          draft=merged.result
        } else draft=head.state
        await this.update({...this.packet,base:head.ref,baseState:head.state,working:draft,known:heads,syncedAt:now()})
      }
      if (this.dirty || !this.packet.vaultFile) {
        await this.prepare(drive,draft,heads,reason)
        await this.send(drive)
        graph=await this.graph(drive)
      }
    }
    if (graph.heads.length>1 && canonical(this.packet.known)!==canonical(graph.heads.map(h=>h.ref))) await this.update({...this.packet,known:graph.heads.map(h=>h.ref)})
    return {graph}
  }
  async cloudBackup(drive,day) {
    if (!this.packet.base || this.dirty) return
    if (!this.packet.backup && this.packet.lastBackup?.commitId===this.packet.base.commitId && !this.packet.needsBackup) return
    if (!this.packet.backup && this.packet.lastBackup?.day===day && !this.packet.needsBackup) return
    if (!this.packet.backup) {
      const fileId=await drive.nextId('backup',this.dataset)
      const payload=await seal(this.root,this.dataset,'backup',{date:day,ref:this.packet.base,vaultFile:this.packet.vaultFile,documents:this.packet.baseState.documents.filter(d=>d.blob_id).map(d=>({id:d.blob_id,driveFileId:d.drive_file_id,sha256:d.sha256}))})
      await this.update({...this.packet,backup:{fileId,payload,day,commitId:this.packet.base.commitId}})
    }
    const {fileId,payload,commitId}=this.packet.backup
    await drive.ensure(fileId,payload,'backup',this.dataset)
    await this.update({...this.packet,backup:null,lastBackup:{day,commitId},needsBackup:false})
  }
}
export async function remoteProfiles(drive) {
  const files=(await drive.list()).filter(f=>f.appProperties?.kind==='vault')
  return Promise.all(files.map(async f=>{
    const {header,genesis}=await drive.get(f.id)
    check(header?.datasetId===f.appProperties.dataset && genesis?.datasetId===header.datasetId,'Dropbox 保管庫の識別子が一致しません。')
    return {header,identity:drive.credential.sub,key:profileKey(drive.credential.sub,header.datasetId),vaultFile:f.id,stamp:null,deviceId:id()}
  }))
}
export function commonBase(graph) {
  const ancestors=head=>{
    const result=new Set(),queue=[head]
    while(queue.length) {
      const item=queue.pop()
      if (result.has(item.ref.driveFileId)) continue
      result.add(item.ref.driveFileId)
      for (const parent of item.parentRefs) queue.push(graph.byId.get(parent.driveFileId))
    }
    return result
  }
  if (graph.heads.length<2) return null
  const sets=graph.heads.map(ancestors)
  const common=[...sets[0]].filter(x=>sets.every(s=>s.has(x)))
  const nonHeads=new Set()
  for (const item of common) {
    for (const x of ancestors(graph.byId.get(item))) if (x!==item) nonHeads.add(x)
  }
  const maximal=common.filter(x=>!nonHeads.has(x))
  return maximal.length===1?graph.byId.get(maximal[0]):null
}
