const express = require("express");
const app = express();
const PORT = 3000;
app.use(express.json());

// MCP Manifest endpoint
app.get("/mcp/manifest", (req, res) => {
  res.sendFile(__dirname + "/manifest.json");
});

// Action: getLayers
app.post("/mcp/getLayers", async(req, res) => {
    try {
        const portal_url = req.body.portal_url;
        const token = req.body.token;

        if (!portal_url) return res.status(400).json({ error: "portal_url required" });
        if (!token) return res.status(400).json({ error: "token required" });

        const searchUrl = `${portal_url.replace(/\/$/, "")}/sharing/rest/search`;
        const params = new URLSearchParams({
            q: "type:\"Feature Service\" OR type:\"Map Service\"",
            f: "json",
            num: "100",
            token: token
        });

        const r = await fetch(`${searchUrl}?${params.toString()}`);
        const j = await r.json();

        const items = (j.results || []).map(item => ({
            id: item.id,
            title: item.title,
            url: item.url || null
        }));

        res.json({ items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Action: query_layer
app.post("/mcp/query_layer", async (req, res) => {
    try {
        const layer_url = req.body.layer_url;
        const token = req.body.token;
        if (!layer_url) return res.status(400).json({ error: "layer_url required" });
        if (!token) return res.status(400).json({ error: "token required" });
        
        const params = new URLSearchParams({
            where:"1=1",
            outFields:"*",
            resultRecordCount: "10",
            returnGeometry: "false",
            f: "json",
            token: token
        });
        if (req.body.geometry) params.set("geometry", JSON.stringify(req.body.geometry));
        const r = await fetch(`${layer_url.replace(/\/$/, "")}/query?${params.toString()}`);
        const j = await r.json();
        res.json(j);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Action: get_statistics    
app.post("/mcp/get_statistics", async (req, res) => {
    try {
        const layer_url = req.body.layer_url;
        const token = req.body.token;
        if (!layer_url) return res.status(400).json({ error: "layer_url required" });
        if (!token) return res.status(400).json({ error: "token required" });
        
        const fields = req.body.statFields.split(",").map(f => {
            const [fieldName, statType] = f.split(":");
            return {
                statisticType: statType || "sum",
                onStatisticField: fieldName
            };
        });
        const params = new URLSearchParams({
            f: "json",
            where:"1=1",
            outStatistics:JSON.stringify(fields),
            returnGeometry: "false",
            token:token
        });

        const queryUrl = `${layer_url.replace(/\/$/, "")}/query?${params.toString()}`;
        const r = await fetch(queryUrl);
        const j = await r.json();
        if (j.error) return res.status(500).json({ error: j.error });

        res.json({ statistics: j.statistics || j.features || j });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "get_statistics failed", detail: err.message ?? err });
    }
});

// Action: export_map
app.post("/mcp/export_map", async (req, res) => {
  try {
    const map_service_url = req.body.map_service_url;
    const token = req.body.token;
    if (!map_service_url) return res.status(400).json({ error: "map_service_url required" });
    if (!token) return res.status(400).json({ error: "token required" });

    const params = new URLSearchParams({
      f: "json",
      size:"1024,768",
      format:"png32",
      token:token
    });
    if (req.body.bbox) params.set("bbox", req.body.bbox);

    const r = await fetch(`${map_service_url.replace(/\/$/, "")}/export?${params.toString()}`);
    const j = await r.json();
    if (j.error) return res.status(500).json({ error: j.error });

    res.json({ image: j.href || j.url || j });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "export_map failed", detail: err.message ?? err });
  }
});

// POST /mcp/get_tradeoffs (strong vs weak pillar comparisons)
app.post('/mcp/get_tradeoffs', async (req, res) => {
    try {
        const { layer_url, token, strong_field, weak_field, strong_threshold, weak_threshold } = req.body;

        if (!layer_url) return res.status(400).json({ error: "layer_url required" });
        if (!token) return res.status(400).json({ error: "token required" });
        if (!strong_field || !weak_field) return res.status(400).json({ error: "strong_field and weak_field required" });

        // Build query parameters
        const params = new URLSearchParams({
            where: "1=1",
            outFields: "*",
            f: "json",
            token: token,
            returnGeometry: "false"
        });

        const response = await fetch(`${layer_url.replace(/\/$/, "")}/query?${params.toString()}`);
        const data = await response.json();

        if (!data.features) return res.status(500).json({ error: "No features returned from layer" });

        // Filter districts based on thresholds
        const results = data.features
            .map(f => f.attributes)
            .filter(attr => 
                attr[strong_field] >= strong_threshold && 
                attr[weak_field] <= weak_threshold
            )
            .map(attr => ({
                district_name: attr["D_NAME_EN"] || "Unknown",
                [strong_field]: attr[strong_field],
                [weak_field]: attr[weak_field]
            }));

        res.json({ count: results.length, districts: results });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /mcp/get_nearest_facility
app.post('/mcp/get_nearest_facility', async (req, res) => {
    try {
        const { feature_service_url, token, x, y } = req.body;

        if (!feature_service_url) return res.status(400).json({ error: "feature_service_url required" });
        if (!token) return res.status(400).json({ error: "token required" });
        if (x === undefined || y === undefined) return res.status(400).json({ error: "x and y coordinates required" });

        const bufferDegrees = 0.01; // ~1km at equator
        const params = new URLSearchParams({
            f: 'json',
            token: token,
            geometry: JSON.stringify({
                xmin: x - bufferDegrees,
                ymin: y - bufferDegrees,
                xmax: x + bufferDegrees,
                ymax: y + bufferDegrees,
                spatialReference: { wkid: 4326 }
            }),
            geometryType: 'esriGeometryEnvelope',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: true,
            resultRecordCount: 10,
            inSR: 4326,                   
            outSR: 4326 
        });
        const response = await fetch(`${feature_service_url.replace(/\/$/, "")}/query?${params.toString()}`);
        const data = await response.json();

        if (!data.features || data.features.length === 0) {
            return res.status(404).json({ message: "No facility found nearby." });
        }

        // Return the nearest
        const facility = data.features
        .map(f => ({
            ...f,
            _dist: Math.sqrt(
            Math.pow(f.geometry.x - x, 2) +
            Math.pow(f.geometry.y - y, 2)
            )
        }))
        .sort((a, b) => a._dist - b._dist)[0];
        res.json({
            attributes: facility.attributes,
            geometry: facility.geometry
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.listen(PORT, () => {
  console.log(`ArcGIS MCP Connector running on http://localhost:${PORT}`);
});


