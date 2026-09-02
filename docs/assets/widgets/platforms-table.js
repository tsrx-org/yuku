// Runtime half of docs/widgets/platforms-table.mjs: marks the row the reader's
// machine matches, as far as the browser will say.
const OS_NAMES = { macOS: 'darwin', Linux: 'linux', Windows: 'win32', Android: 'android', iOS: 'ios', 'Chrome OS': 'chromeos' }
const OS_WORDS = { darwin: 'macOS', linux: 'Linux', win32: 'Windows', android: 'Android', ios: 'iOS', chromeos: 'Chrome OS' }

async function detect() {
  const data = navigator.userAgentData
  if (data?.getHighEntropyValues) {
    try {
      const values = await data.getHighEntropyValues(['architecture', 'bitness', 'platform'])
      const platform = values.platform ?? data.platform ?? ''
      const os = OS_NAMES[platform] ?? (platform ? platform.toLowerCase() : null)
      const arch =
        values.architecture === 'arm' && values.bitness === '64'
          ? 'arm64'
          : values.architecture === 'x86' && values.bitness === '64'
            ? 'x64'
            : null
      return { os, arch }
    } catch {}
  }
  const platform = navigator.platform ?? ''
  const agent = navigator.userAgent ?? ''
  const os = /Mac/.test(platform)
    ? 'darwin'
    : /Win/.test(platform)
      ? 'win32'
      : /Android/.test(agent)
        ? 'android'
        : /Linux/.test(platform)
          ? 'linux'
          : null
  const arch = /aarch64|arm64/i.test(agent) ? 'arm64' : /x86_64|x64|Win64|WOW64/i.test(agent) ? 'x64' : null
  return { os, arch }
}

export default async function mount(root) {
  const status = root.querySelector('[data-widget-status]')
  const rows = [...root.querySelectorAll('[data-platform-row]')]
  const say = (text) => {
    if (status) status.textContent = text
  }
  const { os, arch } = await detect()
  let machineStatus = ''
  for (const row of rows) row.dataset.platformMatch = 'no'
  const osWord = os ? (OS_WORDS[os] ?? os) : null
  if (!os) {
    machineStatus = 'your browser does not say what machine this is, so no row is marked'
  } else {
    const sameOs = rows.filter((row) => row.dataset.os === os)
    const match = arch ? sameOs.find((row) => row.dataset.cpu === arch) : null
    if (match) {
      match.dataset.platformMatch = 'yes'
      match.classList.add('pt-match')
      const libc = match.dataset.libc ? `, if your libc is ${match.dataset.libc}` : ''
      machineStatus = `your browser says ${osWord} on ${arch}: npm installs ${match.querySelector('code').textContent}${libc}`
    } else if (sameOs.length > 0 && !arch) {
      for (const row of sameOs) row.dataset.platformMatch = 'unknown'
      machineStatus = `your browser says ${osWord} but not which CPU; the ${osWord} row applies only on ${sameOs.map((row) => row.dataset.cpu).join(' or ')}`
    } else {
      machineStatus = `your browser says ${osWord}${arch ? ` on ${arch}` : ''}: no prebuilt addon, so import fails`
    }
  }
  say(machineStatus)
  const describe = (row) => say(`${row.querySelector('code').textContent} supports ${row.dataset.os} on ${row.dataset.cpu}.`)
  root.addEventListener('mouseover', (event) => {
    const row = event.target.closest('[data-platform-row]')
    if (row) describe(row)
  })
  root.addEventListener('focusin', (event) => {
    const row = event.target.closest('[data-platform-row]')
    if (row) describe(row)
  })
  root.addEventListener('click', (event) => {
    const row = event.target.closest('[data-platform-row]')
    if (row) describe(row)
  })
  root.addEventListener('mouseleave', () => {
    if (!root.contains(document.activeElement)) say(machineStatus)
  })
  root.dataset.widgetState = 'ready'
}
