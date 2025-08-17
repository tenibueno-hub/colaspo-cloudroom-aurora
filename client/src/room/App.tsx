
import React, { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Indices = { IPE:number; IL:number; IS:number }
type Player = { id:string; name:string; city:{S:number;AP:number;SEG:number}; cash:number; wallet:{codigo:string;nivel:number}[]; token?:string }
type Solic = { id:string; playerId:string; tipo:'COMPRA'|'UPGRADE'; codigo:string; valor:number; sNecessario?:number }
type StateAdmin = { room:string; role:'admin'; indices:Indices; turn:number; players:Player[]; solicitacoes:Solic[]; logs:any[] }
type StatePlayer = { room:string; role:'player'; indices:Indices; turn:number; you:Player|null; solicitacoes:Solic[]; logs:any[] }

function useQuery(){ return new URLSearchParams(location.search) }

export default function App(){
  const [socket, setSocket] = useState<Socket|null>(null)
  const [role, setRole] = useState<'idle'|'admin'|'player'>('idle')
  const [state, setState] = useState<any>(null)
  const [room, setRoom] = useState<string>('')
  const [adminToken, setAdminToken] = useState<string>('')
  const q = useQuery()

  useEffect(()=>{
    const s = io()
    setSocket(s)
    s.on('state', (st:any)=> setState(st))
    return () => { s.disconnect() }
  }, [])

  useEffect(()=>{
    const r = q.get('room'); const pid = q.get('playerId'); const token = q.get('token')
    if(socket && r && pid && token){
      socket.emit('joinAsPlayer', { room: r, playerId: pid, token }, (ack:any)=>{
        if(ack?.ok){ setRole('player'); setRoom(r) } else alert('Link inválido ou sala não encontrada.')
      })
    }
  }, [socket])

  function createRoom(){
    if(!socket) return
    const nome = prompt('Nome do Banco (opcional):') || 'Banco'
    socket.emit('createRoom', nome, (res:any)=>{ setRole('admin'); setRoom(res.room); setAdminToken(res.adminToken) })
  }
  function addPlayer(){
    if(!socket) return
    const name = prompt('Nome do jogador:') || 'Jogador'
    socket.emit('adminAddPlayer', { room, adminToken, name }, (ack:any)=>{
      if(ack?.ok){
        const joinUrl = `${location.origin}${location.pathname}${ack.joinQuery}`
        navigator.clipboard?.writeText(joinUrl)
        alert('Link copiado:\n'+joinUrl)
      }
    })
  }
  function setIdx(key:'IPE'|'IL'|'IS', val:number){ socket?.emit('setIndices', { room, adminToken, indices: { [key]: val } }) }
  function solicitar(tipo:'COMPRA'|'UPGRADE'){
    const codigo = prompt('Código da carta (ex.: PR-EC01):')?.toUpperCase(); if(!codigo) return
    const pid = (state as StatePlayer).you?.id; socket?.emit('playerRequest', { room, playerId: pid, tipo, codigo })
  }
  function aprovar(sid:string){ socket?.emit('bankApprove', { room, adminToken, solicitId: sid }) }
  function recusar(sid:string){ socket?.emit('bankReject', { room, adminToken, solicitId: sid }) }
  function nextTurn(){ socket?.emit('nextTurn', { room, adminToken }) }

  if(role==='idle'){
    return <div className="container">
      <div className="title">Colapso — Salas (Aurora)</div>
      <div className="card">
        <div className="title">Entrar</div>
        <div className="hstack-wrap">
          <button className="btn primary" onClick={createRoom}>Sou o Banco (criar sala)</button>
          <div className="muted">Jogadores: abram o link que o Banco enviar.</div>
        </div>
      </div>
    </div>
  }

  if(role==='admin' && state){
    const st = state as StateAdmin
    return <div className="container">
      <div className="title">Sala {st.room} — Banco (admin)</div>
      <div className="card">
        <div className="hstack-wrap">
          <div className="badge">Turno: {st.turn}</div>
          <div className="badge">IPE {st.indices.IPE}</div>
          <div className="badge">IL {st.indices.IL}</div>
          <div className="badge">IS {st.indices.IS}</div>
        </div>
        <div className="hstack-wrap" style={{marginTop:8}}>
          <button className="btn" onClick={()=>setIdx('IPE', Math.max(0, st.indices.IPE-1))}>IPE −</button>
          <button className="btn" onClick={()=>setIdx('IPE', Math.min(5, st.indices.IPE+1))}>IPE +</button>
          <button className="btn" onClick={()=>setIdx('IL', Math.max(0, st.indices.IL-1))}>IL −</button>
          <button className="btn" onClick={()=>setIdx('IL', Math.min(5, st.indices.IL+1))}>IL +</button>
          <button className="btn" onClick={()=>setIdx('IS', Math.max(0, st.indices.IS-1))}>IS −</button>
          <button className="btn" onClick={()=>setIdx('IS', Math.min(5, st.indices.IS+1))}>IS +</button>
        </div>
        <div className="hstack-wrap" style={{marginTop:8}}>
          <button className="btn primary" onClick={addPlayer}>Adicionar Jogador (gera link)</button>
          <button className="btn warn" onClick={nextTurn}>Fechar Turno</button>
        </div>
      </div>

      <div className="card">
        <div className="title">Solicitações</div>
        {st.solicitacoes.length===0 ? <div className="muted">Vazio</div> :
          st.solicitacoes.map(s=> <div key={s.id} className="hstack-wrap" style={{justifyContent:'space-between',border:'1px solid rgba(255,255,255,.12)',padding:8,borderRadius:8, marginTop:8}}>
            <div className="small"><b>{s.tipo}</b> {s.codigo} • Jogador {s.playerId} • R$ {s.valor.toLocaleString()} {s.sNecessario?`• [S] ${s.sNecessario}`:''}</div>
            <div className="hstack">
              <button className="btn" onClick={()=>recusar(s.id)}>Recusar</button>
              <button className="btn primary" onClick={()=>aprovar(s.id)}>Aprovar</button>
            </div>
          </div>)
        }
      </div>

      <div className="card">
        <div className="title">Jogadores (visualização)</div>
        <div className="grid cols-3">
          {st.players.map(p=> <div key={p.id} className="card">
            <div><b>{p.name}</b> <span className="muted">({p.id})</span></div>
            <div className="hstack-wrap" style={{marginTop:6}}>
              <div className="badge">S {p.city.S}</div>
              <div className="badge">AP {p.city.AP}</div>
              <div className="badge">SEG {p.city.SEG}</div>
              <div className="badge">Caixa R$ {p.cash.toLocaleString()}</div>
            </div>
            <div className="small muted" style={{marginTop:6}}>Carteira: {p.wallet.map(w=>w.codigo+' L'+w.nivel).join(', ') || '—'}</div>
          </div>)}
        </div>
      </div>

      <div className="card">
        <div className="title">Log</div>
        <div className="vstack">
          {st.logs.slice(0,30).map((l:any)=><div key={l.id} className="small">{l.text}</div>)}
        </div>
      </div>
    </div>
  }

  if(role==='player' && state){
    const st = state as StatePlayer; const you = st.you
    return <div className="container">
      <div className="title">Sala {st.room} — Jogador</div>
      <div className="card">
        <div className="hstack-wrap">
          <div className="badge">Turno: {st.turn}</div>
          <div className="badge">IPE {st.indices.IPE}</div>
          <div className="badge">IL {st.indices.IL}</div>
          <div className="badge">IS {st.indices.IS}</div>
        </div>
        {you ? <>
          <div className="hstack-wrap" style={{marginTop:8}}>
            <div className="badge">S {you.city.S}</div>
            <div className="badge">AP {you.city.AP}</div>
            <div className="badge">SEG {you.city.SEG}</div>
            <div className="badge">Caixa R$ {you.cash.toLocaleString()}</div>
          </div>
          <div className="hstack-wrap" style={{marginTop:8}}>
            <button className="btn" onClick={()=>solicitar('COMPRA')}>Solicitar COMPRA por código</button>
            <button className="btn" onClick={()=>solicitar('UPGRADE')}>Solicitar UPGRADE por código</button>
          </div>
          <div className="small muted" style={{marginTop:6}}>Suas solicitações: {st.solicitacoes.length || 0}</div>
          <div className="small muted" style={{marginTop:6}}>Carteira: {you.wallet.map(w=>w.codigo+' L'+w.nivel).join(', ') || '—'}</div>
        </> : <div className="muted">Sem perfil (peça novo link ao Banco)</div>}
      </div>
      <div className="card">
        <div className="title">Log</div>
        <div className="vstack">
          {st.logs.map((l:any)=><div key={l.id} className="small">{l.text}</div>)}
        </div>
      </div>
    </div>
  }

  return <div className="container"><div className="title">Carregando...</div></div>
}
