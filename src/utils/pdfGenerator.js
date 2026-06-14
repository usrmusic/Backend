import puppeteer from 'puppeteer';

let browserInstance = null;
let browserRestartPromise = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) return browserInstance;
  if (browserRestartPromise) return browserRestartPromise;

  browserRestartPromise = puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  }).then((b) => {
    browserInstance = b;
    browserRestartPromise = null;
    b.on('disconnected', () => { browserInstance = null; });
    return b;
  });

  return browserRestartPromise;
}

async function generatePdfBufferFromHtml(html, opts = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(String(html), { waitUntil: 'networkidle0' });
    return await page.pdf({ format: 'A4', printBackground: true, ...opts });
  } finally {
    await page.close();
  }
}

export default generatePdfBufferFromHtml;
