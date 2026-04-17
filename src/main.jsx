import React from 'react'
import ReactDOM from 'react-dom/client'
import { LangProvider } from './LangContext'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, fontFamily: 'monospace', fontSize: 13,
          background: '#fff0f0', color: '#c00', height: '100vh',
          whiteSpace: 'pre-wrap', overflowY: 'auto',
        }}>
          <b>React Error:</b>{'\n\n'}
          {this.state.error.message}{'\n\n'}
          {this.state.error.stack}
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <App />
      </LangProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
