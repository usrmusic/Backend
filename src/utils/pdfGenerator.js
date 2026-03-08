import puppeteer from 'puppeteer';

async function generatePdfBufferFromHtml(html, opts = {}) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(String(html), { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({ format: 'A4', printBackground: true, ...opts });
    await page.close();
    return buffer;
  } finally {
    await browser.close();
  }
}

export default generatePdfBufferFromHtml;
