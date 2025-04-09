// electron-app/main.js

const { app } = require("electron");
const { createWindow } = require("./robotjsControl");

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
