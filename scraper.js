// © github.com/arunpt
import fs from 'fs';
import dotenv from 'dotenv';
import axios from 'axios';
import cheerio from 'cheerio';
import moment from 'moment';
import Downloader from 'nodejs-file-downloader';
import { TelegramClient } from 'telegram';
import { StringSession } from "telegram/sessions/index.js";
import { _parseMessageText } from "telegram/client/messageParse.js"


dotenv.config()

const configs = [
  {
    title: "android",
    slug: "whatsapp"
  },
  {
    title: "business",
    slug: "whatsapp-business"
  },
  {
    title: "wearOs",
    slug: "whatsapp-messenger-wear-os"
  }
];

const getWebContent = async (url) => {
  const res = await axios.get(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
    }
  })
  return res.data;
}

const parseVersions = async (apkSlug) => {
  const appUrl = `https://www.apkmirror.com/uploads/?appcategory=${apkSlug}`;
  const homePage = await getWebContent(appUrl);
  const $ = cheerio.load(homePage);
  const appTitles = $('div.widget_appmanager_recentpostswidget div[class="appRow"] h5.appRowTitle');
  var availableVersions = [];
  for (const titleObj of appTitles) {
    let appTitle = titleObj.attribs?.title;
    if (!appTitle) continue;
    availableVersions.push({
      title: appTitle,
      version: appTitle.match(/\d\.\d+\.\d+\.\d+/gm)[0]
    });
    if (availableVersions.length >= 10) break;
  }
  return availableVersions;
}

const downloadFile = async (url, filename) => {
  const downloader = new Downloader({
    url: url,
    filename: filename,
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
    },
    cloneFiles: false,
  });
  try {
    await downloader.download();
    return filename;
  } catch (error) {
    console.log(error);
    return null
  }
}

const downloadLinkParser = async (org, slug, version) => {
  let formatedVersion = version.replace(/\./g, '-');
  var subSlug = slug == "whatsapp" ? "whatsapp-messenger" : slug;
  const srcUrl = `https://www.apkmirror.com/apk/${org}/${slug}-release/${subSlug}-${formatedVersion}-android-apk-download/`;
  var infoPage = await getWebContent(srcUrl);
  const $ = cheerio.load(infoPage);
  var filename = $('#safeDownload > div > div > div.modal-body > h5:nth-child(1) > span').text().trim();
  var md5 = $('#safeDownload > div > div > div.modal-body > span:nth-child(13)').text();
  var publishedOn = $('#file > div.row.d-flex.f-a-start > div:nth-child(1) > div > div:nth-child(8) > div.appspec-value > span').text();
  var publishedOnIST = moment.utc(publishedOn, "MMMM D, YYYY [at] h:mmA [UTC]").utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss [IST]")
  var apkTitle = $('#masthead > header > div > div > div.f-grow > h1').text().trim();
  var versionCode = $('#variants > div > div > div:nth-child(2) > div:nth-child(1) > span:nth-child(6)').text();
  var downloadPageLink = $('a[class^="accent_bg btn btn-flat downloadButton"]').first().attr('href');
  if (!downloadPageLink) return;
  const downloadPage = await getWebContent('https://www.apkmirror.com' + downloadPageLink);
  const parsedDownloadPage = cheerio.load(downloadPage);
  var apkLink = parsedDownloadPage('a[rel="nofollow"]').first().attr('href');
  return {
    title: apkTitle,
    version: version,
    versioncode: Number(versionCode),
    link: 'https://www.apkmirror.com' + apkLink,
    source: srcUrl,
    md5: md5,
    filename: filename.replace('_apkmirror.com', ''),
    date: publishedOnIST
  }
}

const run = async () => {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  console.log('fetching download links');
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.start({
    botAuthToken: process.env.BOT_TOKEN,
  });
  const updateInfo = {}
  for (const src of configs) {
    var availableVersions = await parseVersions(src.slug)
    updateInfo[src.title] = availableVersions.sort(e => e.version);
    // checking for updates by comparing this data with previous one since i dont wanna use a database so fetching data from github
    var prevData = JSON.parse(fs.readFileSync('releases.json', 'utf8'));

    var preVersions = prevData[src.title].map(item => item.version);
    var currentVersions = availableVersions.map((item) => item.version);

    var updatedVersions = currentVersions.filter(val => !preVersions.includes(val));
    console.log(`found ${updatedVersions.length} release diffs (${src.title})`);
    for (const newVersion of updatedVersions) {
      const releaseInfo = await downloadLinkParser("whatsapp-inc", src.slug, newVersion);
      if (!releaseInfo) continue;
      console.log(`downloading ${releaseInfo.filename}`);
      let caption = `**${/business/i.test(releaseInfo.title) ? 'WhatsApp Business Android' : /wear/i.test(releaseInfo.title) ? 'WhatsApp for Wear OS' : 'Whatsapp Messenger Android'} ${/beta|alpha/.test(releaseInfo.title) ? 'beta' : ''}**\nVersion: \`${releaseInfo.version} (${releaseInfo.versioncode})\`\nPublished on: \`${releaseInfo.date}\`\nMD5: \`${releaseInfo.md5}\``;
      console.log(caption);
      let filePath = await downloadFile(releaseInfo.link, releaseInfo.filename);
      console.log('uploading to telegram');
      await client.sendFile(process.env.CHANNEL_ID, { file: filePath, forceDocument: true, workers: 5, caption: caption });
      fs.unlinkSync(filePath);
    }
    // TODO: edit version message
  }
  fs.writeFileSync('releases.json', JSON.stringify(updateInfo, null, 2));
  console.log('saved version info for future checks');

  client._log.warn("done exiting...");
  await client.disconnect();
  process.exit();
}


run()