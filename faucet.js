const axios = require("axios");
const fs = require("fs");
const { HttpsProxyAgent } = require("https-proxy-agent");

const CAPSLOVER_API_KEY = "你的capsolver API";
const WEBSITE_URL = "https://irys.xyz/faucet";
const SITE_KEY = "0x4AAAAAAA6vnrvBCtS4FAl-";

const PROXIES = fs.readFileSync("proxies.txt", "utf-8")
  .split("\n")
  .map(s => s.trim())
  .filter(Boolean);

const WALLETS = fs.readFileSync("wallets.txt", "utf-8")
  .split("\n")
  .map(s => s.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getProxyAgent(proxyStr) {
  return new HttpsProxyAgent(proxyStr);
}

async function createCaptchaTask() {
  const res = await axios.post("https://api.capsolver.com/createTask", {
    clientKey: CAPSLOVER_API_KEY,
    task: {
      type: "AntiTurnstileTaskProxyLess",
      websiteURL: WEBSITE_URL,
      websiteKey: SITE_KEY
    }
  }, { headers: { "Content-Type": "application/json" } });

  if (!res.data.taskId) {
    throw new Error("创建验证码任务失败: " + JSON.stringify(res.data));
  }
  return res.data.taskId;
}

async function getCaptchaResult(taskId) {
  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const res = await axios.post("https://api.capsolver.com/getTaskResult", {
      clientKey: CAPSLOVER_API_KEY,
      taskId
    }, { headers: { "Content-Type": "application/json" } });

    if (res.data.status === "ready") {
      if (res.data.solution && res.data.solution.token) {
        return res.data.solution.token;
      } else {
        throw new Error("验证码返回结果无token");
      }
    }

    if (res.data.status === "failed" || res.data.errorId !== 0) {
      throw new Error("验证码识别失败：" + JSON.stringify(res.data));
    }
  }
  throw new Error("验证码识别超时");
}

async function solveCaptcha() {
  const taskId = await createCaptchaTask();
  return await getCaptchaResult(taskId);
}

async function claim(wallet, proxy, index, total, attempt) {
  try {
    console.log(`[${index + 1}/${total}] 🟡 第${attempt}次尝试，处理钱包 ${wallet}`);

    const captchaToken = await solveCaptcha();

    const agent = getProxyAgent(proxy);

    const body = {
      captchaToken,
      walletAddress: wallet,
    };

    const res = await axios.post("https://irys.xyz/api/faucet", body, {
      httpsAgent: agent,
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });

    console.log(`[${index + 1}/${total}] ✅ 成功领取水龙头：${wallet}`, res.data);
    return true;
  } catch (e) {
    const errMsg = e.response?.data || e.message || e.toString();
    console.error(`[${index + 1}/${total}] ❌ 第${attempt}次失败 ${wallet}：`, errMsg);
    return false;
  }
}

(async () => {
  for (let i = 0; i < WALLETS.length; i++) {
    const wallet = WALLETS[i];
    const proxy = PROXIES[i % PROXIES.length];

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      success = await claim(wallet, proxy, i, WALLETS.length, attempt);
      if (success) break;

      console.log(`[${i + 1}/${WALLETS.length}] 等待 5 秒后重试..`);
      await sleep(5000);
    }

    if (!success) {
      console.log(`[${i + 1}/${WALLETS.length}] 连续3次失败，跳过钱包 ${wallet}`);
    }

    await sleep(10000);
  }
})();
