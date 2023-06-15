export async function onRequest(context) {
  const url = decodeURIComponent(context.params.url);

  const keys = await context.env.CRAWLER_LINKS_KV.list({
    prefix: context.params.url,
  });

  const uint8ToBase64 = (data) => {
    let result = "";
    for (let index = 0; index < data.length; index += 0x8000) {
      const slice = data.subarray(index, Math.min(index + 0x8000, data.length));
      result += String.fromCharCode.apply(null, slice);
    }
    return btoa(result);
  };

  let result = [];
  for (const key of keys.keys) {
    const screenshot = await context.env.CRAWLER_SCREENSHOTS_KV.get(key.name, {
      type: "arrayBuffer",
    });
    try {
      result.push({
        key: parseInt(key.name.split("-")[1]),
        numCloudflareLinks:
          (await context.env.CRAWLER_LINKS_KV.get(key.name)) ?? "-",
        screenshot: screenshot ? uint8ToBase64(new Uint8Array(screenshot)) : "", // Base64 encode screenshot contents
      });
    } catch (e) {
      return new Response(JSON.stringify({ e: e.message }));
    }
  }

  // KVNamespace.list() orders by lexographical order, and because keys are in the form `{url}-{unix timestamp}`, the results for a given url will be ordered from oldest to newest
  result.reverse(); // but we want reverse chronological order!

  let tableString = "";
  for (const res of result) {
    tableString = tableString.concat(
      `<tr><td>${new Date(res.key).toString()}</td><td>${
        res.numCloudflareLinks
      }</td><td><img src="data:image/png;base64,${res.screenshot}" /></td></tr>`
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en" style="height: 100%">
   <head>
      <meta charset="UTF-8">
      <title>Queues Web Crawler: ${url} Results</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/water.css@2/out/light.css"
      />
   </head>
   <body
      style="
      display: flex;
      align-items: center;
      justify-items: center;
      min-height: 100vh;
      height: fit-content;
      margin-top: -5vh;
      max-width: 600px;
      ">
      <div style="max-width: 100%">
        <h1>Queues Web Crawler: ${url} Results</h1>
        <p>Results, from newest to oldest. If there aren't any results, you may need to request that the page be crawled <a href="../">here</a>. Pages are crawled a maximum of once per hour.</p>
        <table>
           <thead>
               <tr>
                  <th>Date</th>
                  <th>Number of Cloudflare.com Links</th>
                  <th>Screenshot</th>
               </tr>
           </thead>
           ${tableString}
        </table>
      </div>
   </body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  });
}
