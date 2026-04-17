import { useRef, useState, useCallback, useEffect } from 'react'
import styled, { keyframes } from 'styled-components'
import { theme } from '../../theme'
import { useLang } from '../../LangContext'


const glowPulse = keyframes`
  0%, 100% { box-shadow: 0 4px 18px rgba(26,115,232,0.35); }
  50% { box-shadow: 0 4px 28px rgba(26,115,232,0.55); }
`

const Outer = styled.div`
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #f8f9fa, #e8eaed);
  border: 2.5px solid ${theme.colors.border};
  box-shadow: ${theme.shadows.card}, inset 0 2px 8px rgba(255,255,255,0.8);
  position: relative;
  touch-action: none;
  user-select: none;
  flex-shrink: 0;
  cursor: grab;
  transition: opacity ${theme.transitions.fast};
  &:active { cursor: grabbing; }

  /* direction markers */
  &::before {
    content: '';
    position: absolute;
    inset: 8px;
    border-radius: 50%;
    border: 1.5px dashed ${theme.colors.border};
  }
`

const Crosshair = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.25;

  &::before, &::after {
    content: '';
    position: absolute;
    background: ${theme.colors.textMuted};
  }
  &::before {
    top: 50%;
    left: 16px;
    right: 16px;
    height: 1px;
    transform: translateY(-50%);
  }
  &::after {
    left: 50%;
    top: 16px;
    bottom: 16px;
    width: 1px;
    transform: translateX(-50%);
  }
`

const Knob = styled.div`
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: ${p => p.$active
    ? `radial-gradient(circle at 35% 35%, ${theme.colors.primaryLight}, ${theme.colors.primaryDark})`
    : `radial-gradient(circle at 35% 35%, #5A9CF8, ${theme.colors.primary})`
  };
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(calc(-50% + ${p => p.$x}px), calc(-50% + ${p => p.$y}px));
  transition: ${p => p.$dragging
    ? 'none'
    : `transform 0.3s cubic-bezier(0.34,1.56,0.64,1)`
  };
  box-shadow: ${p => p.$active ? 'none' : '0 4px 18px rgba(26,115,232,0.35)'};
  animation: ${p => !p.$dragging && p.$active ? glowPulse : 'none'} 2s ease-in-out infinite;
  border: 2px solid rgba(255,255,255,0.4);

  /* shine */
  &::after {
    content: '';
    position: absolute;
    top: 6px;
    left: 8px;
    width: 14px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255,255,255,0.35);
  }
`

const Label = styled.div`
  font-family: ${theme.fonts.sans};
  font-size: 11px;
  font-weight: 600;
  color: ${theme.colors.textMuted};
  text-align: center;
  margin-top: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`

const RADIUS = 44
const SEND_INTERVAL = 100

// degrees per pixel per 100ms at full deflection (RADIUS=44px)
// Walking  1.4 m/s → 0.14 m/100ms → 0.00000126°/100ms → /44px
// Moto    10.0 m/s → 1.0  m/100ms → 0.000009°/100ms   → /44px
// Car     20.0 m/s → 2.0  m/100ms → 0.000018°/100ms   → /44px
export function Joystick({ udid, baseCoord, onCoordChange, disabled, speedMultiplier = 0.00000003 }) {
  const { t } = useLang()
  const outerRef = useRef(null)
  const wsRef = useRef(null)
  const intervalRef = useRef(null)
  const delta = useRef({ x: 0, y: 0 })
  const posRef = useRef(baseCoord)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  useEffect(() => { posRef.current = baseCoord }, [baseCoord])

  useEffect(() => {
    if (!udid || disabled) return
    const connect = async () => {
      const port = await window.api.getPythonPort()
      const ws = new WebSocket(`ws://127.0.0.1:${port}/joystick/${udid}`)
      wsRef.current = ws
    }
    connect()
    return () => {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [udid, disabled])

  const startLoop = useCallback(() => {
    if (intervalRef.current) return
    intervalRef.current = setInterval(() => {
      const { x, y } = delta.current
      if (Math.abs(x) < 1 && Math.abs(y) < 1) return
      const pos = posRef.current
      if (!pos) return
      const newLat = pos.lat - y * speedMultiplier
      const newLng = pos.lng + x * speedMultiplier
      posRef.current = { lat: newLat, lng: newLng }
      onCoordChange?.({ lat: newLat, lng: newLng })
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ lat: newLat, lng: newLng }))
      }
    }, SEND_INTERVAL)
  }, [onCoordChange, speedMultiplier])

  const stopLoop = useCallback(() => {
    clearInterval(intervalRef.current)
    intervalRef.current = null
  }, [])

  const onPointerDown = useCallback((e) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    startLoop()
  }, [disabled, startLoop])

  const onPointerMove = useCallback((e) => {
    if (!dragging) return
    const rect = outerRef.current.getBoundingClientRect()
    let dx = e.clientX - (rect.left + rect.width / 2)
    let dy = e.clientY - (rect.top + rect.height / 2)
    const d = Math.hypot(dx, dy)
    if (d > RADIUS) { dx = (dx / d) * RADIUS; dy = (dy / d) * RADIUS }
    delta.current = { x: dx, y: dy }
    setKnob({ x: dx, y: dy })
  }, [dragging])

  const onPointerUp = useCallback(() => {
    setDragging(false)
    setKnob({ x: 0, y: 0 })
    delta.current = { x: 0, y: 0 }
    stopLoop()
  }, [stopLoop])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Outer
        ref={outerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ opacity: disabled ? 0.35 : 1 }}
      >
        <Crosshair />
        <Knob $x={knob.x} $y={knob.y} $dragging={dragging} $active={dragging} />
      </Outer>
      <Label>{t.joystickLabel}</Label>
    </div>
  )
}
