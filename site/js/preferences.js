import {check} from './domain.js'

export const PREFERENCE_KEY='shioai-preferences-v1'
export const LOCK_OPTIONS=[[5,'5分'],[10,'10分'],[30,'30分'],[60,'60分'],[0,'自動ロックなし']]
const DEFAULTS={autoLockMinutes:10,rememberDropbox:true}
export function preferences(storage=localStorage) {
  try {
    const saved=JSON.parse(storage.getItem(PREFERENCE_KEY) || 'null')
    return {
      autoLockMinutes:LOCK_OPTIONS.some(([n])=>n===saved?.autoLockMinutes)?saved.autoLockMinutes:DEFAULTS.autoLockMinutes,
      rememberDropbox:typeof saved?.rememberDropbox==='boolean'?saved.rememberDropbox:DEFAULTS.rememberDropbox,
    }
  } catch {return {...DEFAULTS}}
}
export function savePreferences(value,storage=localStorage) {
  check(LOCK_OPTIONS.some(([n])=>n===value.autoLockMinutes) && typeof value.rememberDropbox==='boolean','ロック時間と接続設定を確認してください。')
  storage.setItem(PREFERENCE_KEY,JSON.stringify({autoLockMinutes:value.autoLockMinutes,rememberDropbox:value.rememberDropbox}))
}
export function lockLabel(value) {
  return LOCK_OPTIONS.find(([n])=>n===value)?.[1] || '10分'
}
export function lockDue(value,lastActivity,time=Date.now()) {
  return value>0 && time-lastActivity>=value*60000
}
