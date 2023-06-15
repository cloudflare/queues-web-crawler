export async function onRequest(context) {
  const urlParams = new URL(context.request.url).searchParams;
  const url = urlParams.get("url");

  if (!url) {
    return new Response("No URL provided.", { status: 400 });
  }

  await context.env.CRAWLER_QUEUE.send({
    url,
  });

  return new Response(
    `Sent! Go to <pages URL>.pages.dev/page/${encodeURIComponent(
      url
    )} to see results`
  );
}
