// 由 vite.config.js 的 define 注入，打包時不需手動修改
// 本地開發：IS_TRIAL=true npm run dev  或  IS_TRIAL=false npm run dev
export const IS_TRIAL = typeof __IS_TRIAL__ !== 'undefined' ? __IS_TRIAL__ : false
export const TRIAL_MINUTES = typeof __TRIAL_MINUTES__ !== 'undefined' ? __TRIAL_MINUTES__ : 10
