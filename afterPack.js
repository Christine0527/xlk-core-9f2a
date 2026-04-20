const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  console.log(`[afterPack] Ad-hoc signing: ${appPath}`)

  try {
    execSync(`codesign --sign - --force --deep --options runtime "${appPath}"`, {
      stdio: 'inherit',
    })
    console.log('[afterPack] Ad-hoc signing done')
  } catch (e) {
    console.warn('[afterPack] Signing failed (non-fatal):', e.message)
  }
}
