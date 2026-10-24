 import { Suspense, useEffect, useMemo, useRef, useState, Component } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const ARENA = 20, GAME_TIME = 45, MAX_ROCKS = 16
const rand = (a, b) => a + Math.random() * (b - a)
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

function spawn(avoid, minD) {
  for (let i = 0; i < 60; i++) {
    const p = { x: rand(-ARENA + 2, ARENA - 2), z: rand(-ARENA + 2, ARENA - 2) }
    if (avoid.every(a => dist(a, p) > minD)) return p
  }
  return { x: ARENA - 3, z: ARENA - 3 }
}
const makeRock = (avoid, minD = 4) => ({ id: Math.random(), ...spawn(avoid, minD), s: rand(0.9, 1.5), r: rand(0, 6) })
const initialRocks = () => { const rs = []; for (let i = 0; i < 6; i++) rs.push(makeRock([{ x: 0, z: 0 }, ...rs], 5)); return rs }

let audio
function beep(f = 880, d = 0.12, type = 'triangle') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)()
    const o = audio.createOscillator(), g = audio.createGain()
    o.type = type; o.frequency.value = f
    g.gain.setValueAtTime(0.15, audio.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d)
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + d)
  } catch {}
}

/* ---------- Model loading with safe fallback ---------- */
class Boundary extends Component {
  state = { err: false }
  static getDerivedStateFromError() { return { err: true } }
  render() { return this.state.err ? this.props.fallback : this.props.children }
}
function useAsset(url) {
  const [ok, setOk] = useState(null)
  useEffect(() => {
    fetch(url).then(r => setOk(r.ok && !(r.headers.get('content-type') || '').includes('html'))).catch(() => setOk(false))
  }, [url])
  return ok
}
function Model({ url, size, ground }) {
  const { scene } = useGLTF(url)
  const obj = useMemo(() => {
    const c = scene.clone(true)
    c.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true
        if (o.material && o.material.metalness > 0.6) { o.material = o.material.clone(); o.material.metalness = 0.6 }
      }
    })
    const s = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3())
    c.scale.multiplyScalar(size / (Math.max(s.x, s.y, s.z) || 1))
    const b = new THREE.Box3().setFromObject(c), ctr = b.getCenter(new THREE.Vector3())
    c.position.set(-ctr.x, ground ? -b.min.y : -ctr.y, -ctr.z)
    const g = new THREE.Group(); g.add(c); return g
  }, [scene, size, ground])
  return <primitive object={obj} />
}
function Visual({ url, size, ground, fallback }) {
  const ok = useAsset(url)
  if (ok === null) return null
  if (!ok) return fallback
  return <Boundary fallback={fallback}><Suspense fallback={null}><Model url={url} size={size} ground={ground} /></Suspense></Boundary>
}
const RobotFallback = () => (
  <group>
    <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.8, 0.9, 0.6]} /><meshStandardMaterial color="#5aa9ff" metalness={0.4} roughness={0.4} /></mesh>
    <mesh position={[0, 1.45, 0]} castShadow><boxGeometry args={[0.6, 0.5, 0.5]} /><meshStandardMaterial color="#9fd0ff" metalness={0.4} roughness={0.4} /></mesh>
    <mesh position={[-0.15, 1.5, 0.26]}><sphereGeometry args={[0.07]} /><meshBasicMaterial color="#111" /></mesh>
    <mesh position={[0.15, 1.5, 0.26]}><sphereGeometry args={[0.07]} /><meshBasicMaterial color="#111" /></mesh>
  </group>
)
const CoinFallback = () => (
  <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
    <cylinderGeometry args={[0.5, 0.5, 0.12, 28]} /><meshStandardMaterial color="#ffc933" metalness={0.8} roughness={0.25} emissive="#7a5200" emissiveIntensity={0.4} />
  </mesh>
)

/* ---------- Game world ---------- */
function World({ status, runId, onScore, onTime, onOver }) {
  const player = useRef(), body = useRef(), coinRefs = useRef([])
  const pos = useRef({ x: 0, z: 0 }), keys = useRef({}), facing = useRef(0)
  const coins = useRef([]), timeLeft = useRef(GAME_TIME), score = useRef(0), st = useRef(status)
  const [rocks, setRocks] = useState(initialRocks)
  st.current = status

  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => { scene.environment = null; env.dispose(); pmrem.dispose() }
  }, [gl, scene])

  useEffect(() => {
    const dn = e => { keys.current[e.code] = true; if (e.code.startsWith('Arrow')) e.preventDefault() }
    const up = e => { keys.current[e.code] = false }
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    window.__pad = (code, v) => { keys.current[code] = v }
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  useEffect(() => {
    pos.current = { x: 0, z: 0 }; score.current = 0; timeLeft.current = GAME_TIME
    const rs = initialRocks(); setRocks(rs)
    const cs = []
    for (let i = 0; i < 6; i++) cs.push(spawn([{ x: 0, z: 0 }, ...rs, ...cs], 3))
    coins.current = cs
    rocksRef.current = rs
  }, [runId])
  const rocksRef = useRef(rocks)
  rocksRef.current = rocks

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05), t = state.clock.elapsedTime
    coinRefs.current.forEach((g, i) => {
      const c = coins.current[i]; if (!g || !c) return
      g.position.set(c.x, 1 + Math.sin(t * 3 + i) * 0.15, c.z); g.rotation.y = t * 2.5
    })
    const p = pos.current
    if (st.current === 'playing') {
      const k = keys.current
      let dx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0)
      let dz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0)
      const moving = dx || dz
      if (moving) {
        const l = Math.hypot(dx, dz); dx /= l; dz /= l
        p.x = THREE.MathUtils.clamp(p.x + dx * 8 * dt, -ARENA + 0.8, ARENA - 0.8)
        p.z = THREE.MathUtils.clamp(p.z + dz * 8 * dt, -ARENA + 0.8, ARENA - 0.8)
        const target = Math.atan2(dx, dz); let d = target - facing.current
        d = Math.atan2(Math.sin(d), Math.cos(d)); facing.current += d * Math.min(1, dt * 14)
      }
      if (body.current) body.current.position.y = moving ? Math.abs(Math.sin(t * 12)) * 0.15 : 0

      coins.current.forEach(c => {
        if (dist(c, p) < 1.2) {
          score.current += 1; onScore(score.current); beep(900 + (score.current % 5) * 80)
          const na = [p, ...coins.current, ...rocksRef.current]
          Object.assign(c, spawn(na, 3))
          setRocks(rs => rs.length < MAX_ROCKS ? [...rs, makeRock([p, ...coins.current, ...rs], 5)] : rs)
        }
      })
      for (const r of rocksRef.current) {
        if (dist(r, p) < 0.55 + 0.8 * r.s) { st.current = 'over'; beep(140, 0.5, 'sawtooth'); onOver('rock'); break }
      }
      const before = Math.ceil(timeLeft.current)
      timeLeft.current -= dt
      if (Math.ceil(timeLeft.current) !== before) onTime(Math.max(0, Math.ceil(timeLeft.current)))
      if (timeLeft.current <= 0 && st.current === 'playing') { st.current = 'over'; beep(300, 0.4); onOver('time') }
    }
    if (player.current) { player.current.position.set(p.x, 0, p.z); player.current.rotation.y = facing.current }
    const cam = state.camera
    cam.position.lerp(new THREE.Vector3(p.x * 0.8, 13, p.z * 0.8 + 11), Math.min(1, dt * 4))
    cam.lookAt(p.x * 0.8, 0, p.z * 0.8)
  })

  return (
    <>
      <color attach="background" args={['#0b1020']} />
      <fog attach="fog" args={['#0b1020', 30, 60]} />
      <hemisphereLight args={['#bcd4ff', '#2a3350', 0.9]} />
      <directionalLight position={[10, 18, 8]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={28} shadow-camera-bottom={-28} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ARENA * 2, ARENA * 2]} /><meshStandardMaterial color="#2f6f4f" />
      </mesh>
      <gridHelper args={[ARENA * 2, ARENA * 2, '#3c8f65', '#388a5f']} position={[0, 0.01, 0]} />
      {[[0, -ARENA], [0, ARENA], [-ARENA, 0], [ARENA, 0]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.4, z]} castShadow>
          <boxGeometry args={i < 2 ? [ARENA * 2 + 1, 0.8, 1] : [1, 0.8, ARENA * 2 + 1]} /><meshStandardMaterial color="#d4f56b" />
        </mesh>
      ))}
      {rocks.map(r => (
        <mesh key={r.id} position={[r.x, 0.7 * r.s, r.z]} rotation={[r.r, r.r * 2, 0]} scale={r.s} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#7d8590" flatShading roughness={0.9} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <group key={i} ref={el => (coinRefs.current[i] = el)}>
          <Visual url="/models/coin.glb" size={1.1} fallback={<CoinFallback />} />
        </group>
      ))}
      <group ref={player}><group ref={body}>
        <Visual url="/models/player.glb" size={1.7} ground fallback={<RobotFallback />} />
      </group></group>
    </>
  )
}

/* ---------- UI ---------- */
function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch { return false }
}
export default function App() {
  const [status, setStatus] = useState('ready')
  const [score, setScore] = useState(0), [time, setTime] = useState(GAME_TIME), [runId, setRunId] = useState(0)
  const [best, setBest] = useState(() => +localStorage.getItem('coinrush-best') || 0)
  const [reason, setReason] = useState('')
  const scoreRef = useRef(0)
  const webgl = useMemo(hasWebGL, [])

  const start = () => { scoreRef.current = 0; setScore(0); setTime(GAME_TIME); setReason(''); setRunId(r => r + 1); setStatus('playing') }
  const onScore = n => { scoreRef.current = n; setScore(n) }
  const onOver = why => {
    setReason(why); setStatus('over')
    setBest(b => { const nb = Math.max(b, scoreRef.current); localStorage.setItem('coinrush-best', nb); return nb })
  }
  useEffect(() => {
    const h = e => { if ((e.code === 'Enter' || e.code === 'Space') && status !== 'playing') start() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [status])

  const pad = (code, label, col, row) => (
    <button style={{ gridColumn: col, gridRow: row }} onPointerDown={() => window.__pad?.(code, true)}
      onPointerUp={() => window.__pad?.(code, false)} onPointerLeave={() => window.__pad?.(code, false)}>{label}</button>
  )

  if (!webgl) return (
    <div className="overlay"><div className="card">
      <h1>WebGL is disabled</h1>
      <p>This 3D game needs WebGL. Please enable graphics acceleration in your browser settings (or try another browser) and reload.</p>
    </div></div>
  )

  return (
    <>
      <Canvas shadows camera={{ position: [0, 13, 11], fov: 50 }}>
        <World status={status} runId={runId} onScore={onScore} onTime={setTime} onOver={onOver} />
      </Canvas>
      <div className="hud">
        <div className="pill">🪙 {score}</div>
        <div className={'pill' + (time <= 10 ? ' warn' : '')}>⏱ {time}s</div>
        <div className="pill">🏆 {best}</div>
      </div>
      {status === 'playing' && <div className="pad">{pad('KeyW', '▲', 2, 1)}{pad('KeyA', '◀', 1, 2)}{pad('KeyS', '▼', 2, 2)}{pad('KeyD', '▶', 3, 2)}</div>}
      {status !== 'playing' && (
        <div className="overlay"><div className="card">
          {status === 'ready' ? (<>
            <h1>🪙 Coin Rush</h1>
            <p>Collect coins before time runs out.</p>
            <p>Avoid the rocks. Every coin adds a new rock!</p>
            <p><b>WASD</b> or <b>Arrow keys</b> to move</p>
            <p style={{ fontSize: 13, opacity: .7 }}>Player &amp; coin 3D models generated with Vi3W</p>
          </>) : (<>
            <h1>{reason === 'rock' ? '💥 Crashed!' : "⏰ Time's up!"}</h1>
            <p>Score: <b>{score}</b> &nbsp;|&nbsp; Best: <b>{best}</b></p>
          </>)}
          <button onClick={start}>{status === 'ready' ? 'Play' : 'Play again'}</button>
          <p style={{ fontSize: 12, opacity: .6 }}>or press Enter / Space</p>
        </div></div>
      )}
    </>
  )
}
