export default {
  // 1. Execução Diária Agendada (Cron Trigger: 0 3 * * *)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncSitemapData("https://www.fortatacadista.com.br/sitemap.xml", env));
  },

  // 2. Endpoints HTTP
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ENDPOINT 1: Obter ou Sincronizar Sitemap Dinamicamente
    if (pathname === "/api/sitemap" || pathname === "/api/sitemap/sync") {
      let targetSitemap = url.searchParams.get("sitemapUrl") || "https://www.fortatacadista.com.br/sitemap.xml";
      const sitemapHash = await hashString(targetSitemap);
      const storageKey = `sitemap-${sitemapHash}.json`;

      // Verifica cache no R2 se disponível
      if (pathname === "/api/sitemap" && env.MY_R2_BUCKET) {
        const cachedObject = await env.MY_R2_BUCKET.get(storageKey);
        if (cachedObject) {
          const body = await cachedObject.text();
          return new Response(body, {
            headers: { ...corsHeaders, "Content-Type": "application/json;charset=UTF-8" }
          });
        }
      }

      // Busca dados ao vivo do sitemap
      const liveData = await syncSitemapData(targetSitemap, env, storageKey);
      return new Response(JSON.stringify(liveData), {
        headers: { ...corsHeaders, "Content-Type": "application/json;charset=UTF-8" }
      });
    }

    // ENDPOINT 2: CORS Proxy para Obter HTML do Produto
    const targetUrl = url.searchParams.get("url");
    if (targetUrl) {
      try {
        const response = await fetch(targetUrl, {
          headers: getBrowserHeaders(targetUrl)
        });
        const body = await response.text();
        return new Response(body, {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({
      message: "Worker do Buscador Multimercado Operacional",
      endpoints: ["/api/sitemap?sitemapUrl=...", "/api/sitemap/sync?sitemapUrl=...", "/?url=https://..."]
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};

// --- FUNÇÃO AUXILIAR: BAIXAR E PARSEAR SITEMAP COM AUTO-DETECÇÃO VTEX PRODUCT ---
async function syncSitemapData(rootSitemapUrl, env, storageKey = null) {
  try {
    console.log(`Baixando sitemap do mercado: ${rootSitemapUrl}`);
    let xmlText = await fetchSitemapUrl(rootSitemapUrl, env);

    if (!xmlText) {
      throw new Error("Não foi possível acessar o sitemap especificado.");
    }

    // Identifica sub-sitemaps se for um Sitemap Index
    const subSitemapMatches = [...xmlText.matchAll(/<loc>(https?:\/\/[^<]+\.xml)<\/loc>/gi)];
    let allProductUrls = [];

    if (subSitemapMatches.length > 0 && xmlText.includes("<sitemapindex")) {
      let foundProductSitemap = false;

      for (const match of subSitemapMatches) {
        const subUrl = match[1];
        // Filtra para dar preferência a arquivos com 'product' no nome
        if (subUrl.includes("product")) {
          foundProductSitemap = true;
          const subXml = await fetchSitemapUrl(subUrl, env);
          if (subXml) {
            const urls = [...subXml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)].map(m => m[1]);
            allProductUrls.push(...urls);
          }
        }
      }

      // TRATAMENTO PARA O BISTEK: Se o sitemapindex não listou sitemaps de produtos, tenta forçar 'product-0.xml', 'product-1.xml'
      if (!foundProductSitemap) {
        const origin = new URL(rootSitemapUrl).origin;
        for (let i = 0; i < 5; i++) {
          const fallbackProductSitemapUrl = `${origin}/sitemap/product-${i}.xml`;
          const subXml = await fetchSitemapUrl(fallbackProductSitemapUrl, env);
          if (subXml && subXml.includes("<urlset")) {
            const urls = [...subXml.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)].map(m => m[1]);
            allProductUrls.push(...urls);
          } else {
            break; // Para se não encontrar mais arquivos product-i.xml
          }
        }
      }
    } else {
      allProductUrls = [...xmlText.matchAll(/<loc>(https?:\/\/[^<]+)<\/loc>/gi)].map(m => m[1]);
    }

    const result = {
      status: "success",
      sitemapUrl: rootSitemapUrl,
      totalUrls: allProductUrls.length,
      updatedAt: new Date().toISOString(),
      urls: allProductUrls
    };

    // Salva no Cloudflare R2 se configurado
    if (env.MY_R2_BUCKET && storageKey) {
      await env.MY_R2_BUCKET.put(storageKey, JSON.stringify(result), {
        httpMetadata: { contentType: "application/json" }
      });
      console.log(`Sitemap salvo no R2 com a chave: ${storageKey}`);
    }

    return result;

  } catch (err) {
    console.error("Erro no processamento do sitemap:", err.message);
    return { status: "error", message: err.message, timestamp: new Date().toISOString() };
  }
}

async function fetchSitemapUrl(url, env) {
  try {
    const response = await fetch(url, { headers: getBrowserHeaders(url) });
    if (response.ok) return await response.text();

    // Fallback via ScraperAPI caso haja bloqueio de IP
    if (env && env.SCRAPER_API_KEY) {
      const proxyUrl = `http://api.scraperapi.com?api_key=${env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}`;
      const proxyRes = await fetch(proxyUrl);
      if (proxyRes.ok) return await proxyRes.text();
    }
  } catch (e) {}

  return null;
}

function getBrowserHeaders(targetUrl = "") {
  let origin = "";
  try {
    if (targetUrl) origin = new URL(targetUrl).origin;
  } catch (e) {}

  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "no-cache",
    "Referer": origin ? `${origin}/` : "https://www.google.com/"
  };
}

async function hashString(str) {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}