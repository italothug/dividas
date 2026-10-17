import test from 'node:test'
import { setImmediate } from 'node:timers'
import assert from 'node:assert/strict'
import { createLocalStore } from '../src/lib/localStore.js'
import { createSyncEngine } from '../src/lib/syncEngine.js'
import { deleteEntries, undoDeletion, editEntries } from '../src/lib/operations.js'
import { parseCurrency, validateLedgerState } from '../src/lib/ledger.js'
import { ensureMonths } from '../src/lib/planning.js'
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
const fresh=()=>({mesesLista:['2026-10'],mesAtual:'2026-10',dados:{'2026-10':{entradas:[],saidas:[]}}})
const row={id:'a',desc:'Parcela',tipo:'devem',valor:200,recebida:false,parcelaAtual:1,parcelaTotal:3}
const fixture=()=>{const s=fresh();s.dados['2026-10'].entradas=[{...row}];return ensureMonths(s,'2026-10','2026-12')}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
test('dismissing legacy notice persists without deleting backup, account or queue',()=>{
 const storage=memory(),store=createLocalStore(storage)
 storage.setItem('caderno-contas-estado','original backup')
 store.save('alice',fresh(),2);store.enqueue('alice',fresh(),2)
 assert.equal(store.legacyNoticeDismissed(),false)
 store.dismissLegacyNotice()
 const reopened=createLocalStore(storage)
 assert.equal(reopened.legacyNoticeDismissed(),true)
 assert.equal(reopened.legacy(),'original backup')
 assert.ok(reopened.snapshot('alice'));assert.ok(reopened.pending('alice'))
})
test('Brazilian thousands and decimals are unambiguous; malformed amounts reject',()=>{
 for(const [input,expected] of [['1.000',1000],['R$ 1.234,56',1234.56],['1000.25',1000.25],['0,01',.01]])assert.equal(parseCurrency(input),expected)
 for(const input of ['1.00,00','1e3','12abc','1,234',''])assert.ok(Number.isNaN(parseCurrency(input)))
})
test('backup rejects duplicate identities, excess precision and invalid installments',()=>{
 for(const mutate of [s=>s.mesesLista.push('2026-10'),s=>s.dados['2026-10'].entradas.push({...row}),s=>s.dados['2026-10'].entradas[0].valor=1.001,s=>s.dados['2026-10'].entradas[0].parcelaAtual=4]){
 const s=fixture();mutate(s);assert.equal(validateLedgerState(s).valid,false)
 }
})
test('undo restores only removed entries, retaining subsequent additions and updates',()=>{
 const s=fixture(),removed=deleteEntries(s,'2026-10','entradas',row)
 removed.state.dados['2026-10'].saidas.push({id:'later',desc:'New',valor:50})
 const restored=undoDeletion(removed.state,removed.undo)
 assert.equal(restored.dados['2026-10'].entradas[0].id,'a')
 assert.equal(restored.dados['2026-10'].saidas[0].id,'later')
 assert.equal(restored.cancellations.length,0)
})
test('future edits update pending installments and preserve received ones',()=>{
 const s=fixture();s.dados['2026-11'].entradas[0].recebida=true
 const edited=editEntries(s,'2026-10','entradas',row,{...row,valor:150},'future')
 assert.equal(edited.dados['2026-11'].entradas[0].valor,200)
 assert.equal(edited.dados['2026-12'].entradas[0].valor,150)
 assert.equal(validateLedgerState(edited).valid,true)
})
test('single installment edit leaves future installments unchanged',()=>{
 const s=editEntries(fixture(),'2026-10','entradas',row,{...row,valor:150},'one')
 assert.equal(s.dados['2026-11'].entradas[0].valor,200)
})
test('future deletion preserves received installments and prevents regeneration',()=>{
 const s=fixture();s.dados['2026-11'].entradas[0].recebida=true
 const removed=deleteEntries(s,'2026-10','entradas',row,'future')
 const next=ensureMonths(removed.state,'2026-10','2027-01')
 assert.equal(next.dados['2026-11'].entradas.length,1)
 assert.equal(next.dados['2026-12'].entradas.length,0)
})
test('local snapshots and pending queues are isolated across users and guest',()=>{
 const store=createLocalStore(memory());store.enqueue('alice',fresh(),2);store.save('alice',fresh(),2)
 assert.equal(store.pending('bob'),null);assert.equal(store.snapshot('guest'),null)
 store.clear('bob');assert.ok(store.pending('alice'))
})
test('acknowledging an older operation retains newer pending work',()=>{
 const store=createLocalStore(memory()),a=store.enqueue('a',{n:1},1)
 const b=store.enqueue('a',{n:2},1);store.acknowledge('a',a,2)
 assert.equal(store.pending('a').id,b.id);assert.equal(store.pending('a').baseVersion,2)
})
test('offline edits retry and are acknowledged only after server success',async()=>{
 const store=createLocalStore(memory());let online=false,calls=0
 const engine=createSyncEngine({owner:'a',store,online:()=>online,remote:{load:async()=>({state:fresh(),version:1}),save:async()=>{calls++;return {version:2}}}})
 await engine.initialize();engine.save(fresh());assert.equal(calls,0);assert.ok(store.pending('a'))
 online=true;await engine.flush();assert.equal(calls,1);assert.equal(store.pending('a'),null)
})
test('new edits during an in-flight write survive failure of the second write',async()=>{
 const store=createLocalStore(memory());let release,calls=0
 const engine=createSyncEngine({owner:'a',store,remote:{load:async()=>({state:{n:0},version:1}),save:async()=>{calls++;if(calls===1)return new Promise(r=>{release=r});throw new Error('offline')}}})
 await engine.initialize();engine.save({n:1});engine.save({n:2});release({version:2});await tick()
 assert.equal(store.pending('a').state.n,2);assert.equal(store.pending('a').baseVersion,2)
})
test('disposing an identity ignores its delayed network response',async()=>{
 const store=createLocalStore(memory());let release;const events=[]
 const engine=createSyncEngine({owner:'alice',store,emit:e=>events.push(e),remote:{load:async()=>new Promise(r=>{release=r}),save:async()=>{}}})
 const loading=engine.initialize();engine.dispose();release({state:fresh(),version:2});await loading
 assert.equal(events.length,0);assert.equal(store.snapshot('alice'),null)
})
test('cloud conflict never silently overwrites local work and supports choosing cloud',async()=>{
 const store=createLocalStore(memory());store.enqueue('a',{n:1},1);let saves=0;const events=[]
 const engine=createSyncEngine({owner:'a',store,emit:e=>events.push(e),remote:{load:async()=>({state:{n:2},version:2}),save:async()=>{saves++}}})
 await engine.initialize();assert.equal(saves,0);assert.ok(events.some(e=>e.conflict))
 assert.equal(store.pending('a').state.n,1);engine.resolve(false);assert.equal(store.snapshot('a').state.n,2);assert.equal(store.pending('a'),null)
})
