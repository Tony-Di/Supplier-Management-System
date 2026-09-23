import { createApp } from "./app";
import { getConfig } from "./config";

const { port } = getConfig();
createApp().listen(port, () => console.log(`Global Sourcing API listening on http://127.0.0.1:${port}`));
