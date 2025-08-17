
import express from 'express'
import compression from 'compression'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { Server } from 'socket.io'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(compression())

const distPath = path.resolve(__dirname, '../client/dist')
app.use(express.static(distPath))

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next()
  res.sendFile(path.join(distPath, 'index.html'))
})

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })
const PORT = process.env.PORT || 3000

const PESOS = { ECONOMIA:[5,2,2], INFRA:[3,5,2], EDUCACAO:[2,3,4], SAUDE:[2,3,5], SEGTEC:[2,3,4] }
const rentMultiplierPerPoint = 0.05
const costPerIPE = 0.03
function uid(n=8){ return Math.random().toString(36).slice(2,2+n) }
function code(n=6){ const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<n;i++) s+=a[Math.floor(Math.random()*a.length)]; return s }
function indiceComposto(cat, idx){ const [wI,wL,wS] = PESOS[cat]; const sum=wI+wL+wS; return (wI*idx.IPE + wL*idx.IL + wS*idx.IS)/sum }
function multRenda(cat, idx){ return 1 + rentMultiplierPerPoint * indiceComposto(cat, idx) }
function multCustoPorIPE(ipe){ return 1 + costPerIPE*ipe }
function custoS(temS, Sbase, IL){ if(!temS) return 0; const base = Sbase ?? 0; if(IL<=1) return base+1; if(IL>=4) return Math.max(0, base-1); return base }
function pipPorIL(IL){ if(IL<=1) return 8000; if(IL===4) return 11000; if(IL>=5) return 12000; return 10000 }
function arredMil(v){ return Math.round(v/1000)*1000 }

const CATALOGO = [
  { codigo:'PR-EC01', categoria:'ECONOMIA', rendaBase:30000, custoCompraBase:50000, custoBaseUpgrade:20000, possuiS:true, Sbase:1 },
  { codigo:'PR-EC02', categoria:'ECONOMIA', rendaBase:24000, custoCompraBase:42000, custoBaseUpgrade:18000, possuiS:true, Sbase:1 },
  { codigo:'PR-IF01', categoria:'INFRA', rendaBase:18000, custoCompraBase:34000, custoBaseUpgrade:14000, possuiS:true, Sbase:2 },
  { codigo:'PR-ED01', categoria:'EDUCACAO', rendaBase:15000, custoCompraBase:27000, custoBaseUpgrade:11000, possuiS:false },
  { codigo:'PR-SA01', categoria:'SAUDE', rendaBase:20000, custoCompraBase:38000, custoBaseUpgrade:16000, possuiS:true, Sbase:1 },
  { codigo:'PR-ST01', categoria:'SEGTEC', rendaBase:15000, custoCompraBase:26000, custoBaseUpgrade:11000, possuiS:true, Sbase:1 },
]
const MAPA = Object.fromEntries(CATALOGO.map(c=>[c.codigo, c]))

const rooms = new Map()
function viewFor(role, room, playerId){
  if(role==='admin'){ return { room:room.code, role, indices:room.indices, turn:room.turn, players:Array.from(room.players.values()).map(p=>({...p})), solicitacoes:room.solicitacoes.slice(), logs:room.logs.slice(0,200) } }
  if(role==='player'){ const p=room.players.get(playerId); return { room:room.code, role, indices:room.indices, turn:room.turn, you:p?{...p}:null, solicitacoes:room.solicitacoes.filter(s=>s.playerId===playerId), logs:room.logs.slice(-30) } }
  return { room: room.code, role, indices: room.indices, turn: room.turn }
}
function broadcast(room){
  for(const s of io.sockets.sockets.values()){
    const rs = s.data.roomCode; if(rs !== room.code) continue
    const role = s.data.role; const pid = s.data.playerId
    s.emit('state', viewFor(role, room, pid))
  }
}

io.on('connection', (socket)=>{
  socket.on('createRoom', (name, ack)=>{
    const roomCode = code(6); const adminToken = uid(12)
    const room = { code:roomCode, adminToken, indices:{IPE:3,IL:3,IS:3}, turn:1, players:new Map(), solicitacoes:[], logs:[] }
    const bankPlayer = { id: uid(), name: name||'Banco', city:{S:2,AP:3,SEG:3}, cash:200000, wallet:[] }
    room.players.set(bankPlayer.id, bankPlayer); rooms.set(roomCode, room)
    socket.data = { role:'admin', roomCode, adminToken, playerId: bankPlayer.id }
    socket.join(roomCode); if(ack) ack({ room:roomCode, adminToken, playerId:bankPlayer.id })
    socket.emit('state', viewFor('admin', room))
  })

  socket.on('joinAsPlayer', ({ room, playerId, token, name }, ack)=>{
    const r = rooms.get(room); if(!r){ ack&&ack({ ok:false, error:'ROOM_NOT_FOUND' }); return }
    let p=null
    if(playerId && token){ p=r.players.get(playerId); if(!p || p.token!==token){ ack&&ack({ ok:false, error:'AUTH_ERROR' }); return } }
    else { const id=uid(); const t=uid(10); p={ id, token:t, name:name||('Jogador '+(r.players.size)), city:{S:2,AP:3,SEG:3}, cash:100000, wallet:[] }; r.players.set(id,p) }
    socket.data = { role:'player', roomCode:r.code, playerId:p.id }
    socket.join(r.code); ack&&ack({ ok:true, playerId:p.id, token:p.token })
    socket.emit('state', viewFor('player', r, p.id)); broadcast(r)
  })

  socket.on('adminAddPlayer', ({ room, adminToken, name }, ack)=>{
    const r=rooms.get(room); if(!r || r.adminToken!==adminToken){ ack&&ack({ ok:false, error:'AUTH_ERROR' }); return }
    const id=uid(); const token=uid(10); const p={ id, token, name:name||'Jogador', city:{S:2,AP:3,SEG:3}, cash:100000, wallet:[] }
    r.players.set(id, p); const joinQuery = `?room=${room}&playerId=${id}&token=${token}`
    ack&&ack({ ok:true, playerId:id, token, joinQuery }); broadcast(r)
  })

  socket.on('setIndices', ({ room, adminToken, indices })=>{
    const r=rooms.get(room); if(!r || r.adminToken!==adminToken) return
    r.indices = { ...r.indices, ...indices }; r.logs.unshift({ id:uid(), turn:r.turn, text:`Índices: IPE ${r.indices.IPE}, IL ${r.indices.IL}, IS ${r.indices.IS}` })
    broadcast(r)
  })

  socket.on('playerRequest', ({ room, playerId, tipo, codigo })=>{
    const r=rooms.get(room); if(!r) return; const p=r.players.get(playerId); if(!p) return
    const base=MAPA[codigo]; if(!base) return
    if(tipo==='COMPRA'){ const sNeed=custoS(base.possuiS, base.Sbase, r.indices.IL); r.solicitacoes.unshift({ id:uid(), playerId, tipo, codigo, valor:base.custoCompraBase, sNecessario:sNeed }) }
    if(tipo==='UPGRADE'){ r.solicitacoes.unshift({ id:uid(), playerId, tipo, codigo, valor:base.custoBaseUpgrade }) }
    r.logs.unshift({ id:uid(), turn:r.turn, playerId, text:`SOLICITAÇÃO ${tipo} ${codigo}` }); broadcast(r)
  })

  socket.on('bankApprove', ({ room, adminToken, solicitId })=>{
    const r=rooms.get(room); if(!r || r.adminToken!==adminToken) return
    const i=r.solicitacoes.findIndex(s=>s.id===solicitId); if(i<0) return
    const s=r.solicitacoes[i]; const p=r.players.get(s.playerId); const base=MAPA[s.codigo]; if(!p||!base) return
    if(s.tipo==='COMPRA'){
      let S=p.city.S; let cash=p.cash - s.valor; const pip=pipPorIL(r.indices.IL); const need=s.sNecessario||0
      if(need>0){ if(S>=need){ S-=need } else { const deficit=need-S; S=0; cash -= deficit*pip } }
      const jaTem=p.wallet.some(w=>w.codigo===s.codigo); if(!jaTem) p.wallet.push({ codigo:s.codigo, nivel:1 })
      p.city.S=S; p.cash=cash; r.logs.unshift({ id:uid(), turn:r.turn, playerId:p.id, text:`APROVADO COMPRA ${s.codigo}` })
    } else if(s.tipo==='UPGRADE'){
      const idx=p.wallet.findIndex(w=>w.codigo===s.codigo); if(idx<0) return
      const atual=p.wallet[idx]; if(atual.nivel>=5){ r.solicitacoes.splice(i,1); return }
      const prox=atual.nivel+1; const fator={2:1.4,3:1.6,4:1.8,5:2.0}[prox]; const custo=arredMil(base.custoBaseUpgrade * fator * (1+0.03*r.indices.IPE))
      p.cash -= custo; atual.nivel = prox; r.logs.unshift({ id:uid(), turn:r.turn, playerId:p.id, text:`APROVADO UPGRADE ${s.codigo} → L${prox}` })
    }
    r.solicitacoes.splice(i,1); broadcast(r)
  })

  socket.on('bankReject', ({ room, adminToken, solicitId })=>{
    const r=rooms.get(room); if(!r || r.adminToken!==adminToken) return
    const i=r.solicitacoes.findIndex(s=>s.id===solicitId); if(i<0) return
    const s=r.solicitacoes[i]; r.solicitacoes.splice(i,1); r.logs.unshift({ id:uid(), turn:r.turn, playerId:s.playerId, text:`RECUSADO ${s.tipo} ${s.codigo}` }); broadcast(r)
  })

  socket.on('nextTurn', ({ room, adminToken })=>{
    const r=rooms.get(room); if(!r || r.adminToken!==adminToken) return
    for(const p of r.players.values()){
      let renda=0, sManut=0
      for(const w of p.wallet){
        const b=MAPA[w.codigo]; const mult=1 + 0.05*((5*b.categoria==='ECONOMIA'?1:0)+(3*b.categoria==='INFRA'?1:0)) // simplificado, mas mantemos ajustes
        let rendaW=Math.round(b.rendaBase * (1 + 0.05)) // simplificado
        if(['EDUCACAO','SAUDE','SEGTEC'].includes(b.categoria)){ if(r.indices.IS<=1) rendaW-=1000; if(r.indices.IS>=4) rendaW+=1000 }
        renda += Math.max(0, rendaW)
        sManut += b.possuiS && b.Sbase ? 1 : 0
      }
      const pip=pipPorIL(r.indices.IL)
      let S=p.city.S; let cash=p.cash + renda
      if(sManut>0){ if(S>=sManut){ S-=sManut } else { const d=sManut-S; S=0; cash -= d*pip } }
      p.cash=cash; p.city.S=S; r.logs.unshift({ id:uid(), turn:r.turn, playerId:p.id, text:`TURNO ${r.turn} • Renda +R$ ${renda} • Manut ${sManut}` })
    }
    r.turn += 1; broadcast(r)
  })
})

httpServer.listen(PORT, ()=>{ console.log('CloudRoom Aurora on :' + PORT) })
