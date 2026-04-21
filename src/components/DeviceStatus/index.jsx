import styled, { keyframes } from 'styled-components'
import { theme } from '../../theme'
import { useLang } from '../../LangContext'

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.85); }
`

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 56px;
  background: ${theme.colors.surface};
  border-bottom: 1px solid ${theme.colors.border};
  font-family: ${theme.fonts.sans};
  font-size: 13px;
  color: ${theme.colors.textSecondary};
  -webkit-app-region: drag;
  user-select: none;
  box-shadow: 0 1px 4px rgba(60,64,67,0.08);
  z-index: 100;
`

const Left = styled.div`
  width: 72px;
  flex-shrink: 0;
  -webkit-app-region: drag;
`

const Logo = styled.div`
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: ${theme.colors.primary};
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  span { color: ${theme.colors.accent3}; }
`

const DeviceSelect = styled.select`
  -webkit-app-region: no-drag;
  background: ${theme.colors.surfaceHover};
  border: 1.5px solid ${theme.colors.border};
  border-radius: ${theme.radii.full};
  color: ${theme.colors.textPrimary};
  font-family: ${theme.fonts.sans};
  font-size: 13px;
  padding: 6px 14px;
  cursor: pointer;
  outline: none;
  transition: all ${theme.transitions.fast};
  font-weight: 500;
  min-width: 180px;
  &:focus, &:hover { border-color: ${theme.colors.primary}; background: ${theme.colors.surface}; }
`

const Dot = styled.span`
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: ${p => p.$active ? theme.colors.success : theme.colors.textMuted};
  flex-shrink: 0;
  animation: ${p => p.$active ? pulse : 'none'} 2s ease-in-out infinite;
`

const NoDevice = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${theme.colors.textMuted};
  font-size: 13px;
  background: ${theme.colors.surfaceHover};
  border-radius: ${theme.radii.full};
  padding: 6px 14px;
  border: 1.5px dashed ${theme.colors.border};
`

const ActionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
`

const Spacer = styled.div`
  flex: 1;
`

const MountBtn = styled.button`
  -webkit-app-region: no-drag;
  padding: 7px 18px;
  border-radius: ${theme.radii.full};
  border: none;
  background: ${p => p.$loading
    ? theme.colors.border
    : p.$success
      ? 'linear-gradient(135deg, #34a853, #1e8e3e)'
      : `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight})`};
  color: ${p => p.$loading ? theme.colors.textMuted : '#fff'};
  font-family: ${theme.fonts.sans};
  font-size: 13px;
  font-weight: 600;
  cursor: ${p => (p.$loading || p.$success) ? 'default' : 'pointer'};
  transition: all ${theme.transitions.normal};
  box-shadow: ${p => p.$loading ? 'none' : p.$success ? '0 2px 8px rgba(52,168,83,0.4)' : theme.shadows.button};

  &:hover:not(:disabled):not([data-success]) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(26,115,232,0.4);
  }
  &:active:not(:disabled) { transform: translateY(0); }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`

const LangBtn = styled.button`
  -webkit-app-region: no-drag;
  padding: 5px 13px;
  border-radius: ${theme.radii.full};
  border: 1.5px solid ${theme.colors.border};
  background: ${theme.colors.surface};
  color: ${theme.colors.textSecondary};
  font-family: ${theme.fonts.sans};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all ${theme.transitions.fast};
  letter-spacing: 0.02em;

  &:hover {
    border-color: ${theme.colors.primary};
    color: ${theme.colors.primary};
    background: #e8f0fe;
  }
`

const ErrorMsg = styled.span`
  color: ${theme.colors.error};
  font-size: 12px;
  background: #fce8e6;
  padding: 4px 10px;
  border-radius: ${theme.radii.full};
  font-weight: 500;
`

export function DeviceStatus({ devices, selected, onSelect, onMount, mounting, mounted, error }) {
  const { t, toggle } = useLang()
  return (
    <Bar>
      <Left />
      <Logo>📍 iOS Location<span> Master</span></Logo>
      <Dot $active={devices.length > 0} />
      {devices.length === 0 ? (
        <NoDevice>{t.noDevice}</NoDevice>
      ) : (
        <DeviceSelect
          value={selected?.udid || ''}
          onChange={e => onSelect(devices.find(d => d.udid === e.target.value))}
        >
          {devices.map(d => (
            <option key={d.udid} value={d.udid}>
              📱 {d.name} · iOS {d.ios_version}
            </option>
          ))}
        </DeviceSelect>
      )}
      {error && <ErrorMsg>{t.errorPrefix} {error}</ErrorMsg>}
      <Spacer />
      <LangBtn onClick={toggle}>{t.langToggle}</LangBtn>
    </Bar>
  )
}
