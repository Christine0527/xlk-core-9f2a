import { useState } from 'react'
import styled, { keyframes } from 'styled-components'
import { theme } from '../../theme'

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
`

const float = keyframes`
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-10px); }
`

const pulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(26,115,232,0.4); }
  50%       { box-shadow: 0 0 0 18px rgba(26,115,232,0); }
`

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: linear-gradient(160deg, #e8f0fe 0%, #f1f3f4 50%, #e6f4ea 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 32px;
`

const SkipBtn = styled.button`
  position: absolute;
  top: 20px;
  right: 24px;
  background: none;
  border: none;
  font-family: ${theme.fonts.sans};
  font-size: 13px;
  font-weight: 500;
  color: ${theme.colors.textMuted};
  cursor: pointer;
  padding: 8px 12px;
  border-radius: ${theme.radii.full};
  transition: all ${theme.transitions.normal};
  &:hover { background: rgba(0,0,0,0.06); color: ${theme.colors.textSecondary}; }
`

const IllustrationWrap = styled.div`
  animation: ${float} 4s ease-in-out infinite;
  margin-bottom: 36px;
`

const GlobeCircle = styled.div`
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight});
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 32px rgba(26,115,232,0.35);
  animation: ${pulse} 3s ease-in-out infinite;
`

const Content = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  animation: ${fadeUp} 0.6s ease both;
  max-width: 520px;
  width: 100%;
`

const AppName = styled.h1`
  font-family: ${theme.fonts.sans};
  font-size: 32px;
  font-weight: 800;
  color: ${theme.colors.textPrimary};
  letter-spacing: -0.5px;
  margin: 0;
`

const Tagline = styled.p`
  font-family: ${theme.fonts.sans};
  font-size: 15px;
  font-weight: 400;
  color: ${theme.colors.textSecondary};
  margin: 0;
  text-align: center;
  line-height: 1.6;
`

const ActionBtn = styled.button`
  margin-top: 24px;
  padding: 14px 48px;
  border-radius: ${theme.radii.full};
  border: none;
  background: linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight});
  color: #fff;
  font-family: ${theme.fonts.sans};
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: ${theme.shadows.button};
  transition: all ${theme.transitions.spring};
  letter-spacing: 0.02em;
  &:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(26,115,232,0.45); }
  &:active { transform: translateY(0); }
`

const Dots = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 20px;
`

const Dot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${p => p.$active ? theme.colors.primary : theme.colors.border};
  transition: all ${theme.transitions.normal};
`

// ─── Page 2 ──────────────────────────────────────────
const TipsTitle = styled.h2`
  font-family: ${theme.fonts.sans};
  font-size: 22px;
  font-weight: 800;
  color: ${theme.colors.textPrimary};
  margin: 0 0 4px;
  text-align: center;
`

const TipsSubtitle = styled.p`
  font-size: 13px;
  color: ${theme.colors.textMuted};
  text-align: center;
  margin: 0 0 20px;
  font-family: ${theme.fonts.sans};
`

const TipsList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
`

const TipItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #fff;
  border-radius: ${theme.radii.md};
  border: 1.5px solid ${theme.colors.border};
  padding: 12px 16px;
  box-shadow: ${theme.shadows.soft};
`

const TipIcon = styled.div`
  font-size: 22px;
  flex-shrink: 0;
  line-height: 1.3;
`

const TipText = styled.div`
  font-family: ${theme.fonts.sans};
  font-size: 13.5px;
  color: ${theme.colors.textPrimary};
  line-height: 1.6;
  b { font-weight: 700; color: ${theme.colors.primary}; }
  span { font-size: 12px; color: ${theme.colors.textMuted}; display: block; margin-top: 2px; }
`

const TIPS = [
  {
    icon: '🔧',
    title: '開啟開發者模式',
    desc: '設定 → 隱私權與安全性 → 開發者模式 → 開啟',
  },
  {
    icon: '🔓',
    title: '保持手機解鎖',
    desc: '鎖屏狀態下無法接收模擬定位，請保持螢幕亮起',
  },
  {
    icon: '🗺',
    title: '開啟定位相關的 App',
    desc: '請先開啟 Apple 地圖 或 Google Maps，讓定位服務在前景運作，模擬才會生效',
  },
  {
    icon: '📍',
    title: '確認定位服務已開啟',
    desc: '設定 → 隱私權與安全性 → 定位服務 → 開啟',
  },
]

export function Onboarding({ onDone }) {
  const [page, setPage] = useState(0)

  return (
    <Overlay>
      <SkipBtn onClick={onDone}>略過</SkipBtn>

      {page === 0 ? (
        <>
          <IllustrationWrap>
            <GlobeCircle>
              <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
                <circle cx="30" cy="30" r="26" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none"/>
                <path d="M30 14C24.477 14 20 18.477 20 24C20 31.5 30 44 30 44C30 44 40 31.5 40 24C40 18.477 35.523 14 30 14Z" fill="white"/>
                <circle cx="30" cy="24" r="5" fill={theme.colors.primary}/>
                <path d="M6 30 Q18 26 30 30 Q42 34 54 30" stroke="rgba(255,255,255,0.35)" strokeWidth="1" fill="none"/>
                <path d="M10 20 Q20 17 30 20 Q40 23 50 20" stroke="rgba(255,255,255,0.25)" strokeWidth="1" fill="none"/>
                <path d="M30 4 Q36 17 30 30 Q24 43 30 56" stroke="rgba(255,255,255,0.3)" strokeWidth="1" fill="none"/>
              </svg>
            </GlobeCircle>
          </IllustrationWrap>

          <Content>
            <AppName>iOS Location Master</AppName>
            <Tagline>
              Be what you wanna be.<br />
              隨時隨地，成為你想去的地方。
            </Tagline>
            <ActionBtn onClick={() => setPage(1)}>下一步 →</ActionBtn>
            <Dots>
              <Dot $active />
              <Dot />
            </Dots>
          </Content>
        </>
      ) : (
        <Content>
          <TipsTitle>使用前注意事項</TipsTitle>
          <TipsSubtitle>請確認以下設定，才能正常模擬 GPS 定位</TipsSubtitle>
          <TipsList>
            {TIPS.map((tip, i) => (
              <TipItem key={i}>
                <TipIcon>{tip.icon}</TipIcon>
                <TipText>
                  <b>{tip.title}</b>
                  <span>{tip.desc}</span>
                </TipText>
              </TipItem>
            ))}
          </TipsList>
          <ActionBtn onClick={onDone}>開始使用</ActionBtn>
          <Dots>
            <Dot />
            <Dot $active />
          </Dots>
        </Content>
      )}
    </Overlay>
  )
}
