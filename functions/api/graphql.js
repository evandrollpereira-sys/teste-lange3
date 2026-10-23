const UPSTREAM_URL = "https://api.fortatacadista.com.br/storefront/graphql";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type"
      }
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Use POST para enviar uma consulta GraphQL." }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo da requisição não contém JSON válido." }, 400);
  }

  let payload;
  if (body?.mode === "introspect") {
    payload = {
      query: `query IntrospectionQuery {
        __schema {
          queryType { name }
          mutationType { name }
          types { name kind description }
        }
      }`
    };
  } else if (typeof body?.query === "string" && body.query.trim()) {
    payload = {
      query: body.query,
      ...(body.variables && typeof body.variables === "object"
        ? { variables: body.variables }
        : {})
    };
  } else {
    return json({
      error: "Envie {\"mode\":\"introspect\"} ou um objeto com a propriedade \"query\"."
    }, 400);
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json"
      },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    const text = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        responsePreview: text.slice(0, 5000),
        note: "A resposta do servidor não era JSON."
      };
    }

    return json({
      upstreamStatus: upstream.status,
      upstreamOk: upstream.ok,
      upstreamUrl: UPSTREAM_URL,
      response: parsed
    }, 200);
  } catch (error) {
    return json({
      error: "Não foi possível consultar o endpoint externo.",
      details: String(error?.message || error),
      upstreamUrl: UPSTREAM_URL
    }, 502);
  }
}
