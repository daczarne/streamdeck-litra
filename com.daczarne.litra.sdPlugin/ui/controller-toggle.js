// Shows the key or the dial settings, depending on where the action is placed. A file rather than an inline script,
// so the pages' Content-Security-Policy doesn't have to allow inline scripts.
(async () => {
  const info = await SDPIComponents.streamDeckClient.getConnectionInfo();
  const controller = info?.actionInfo?.payload?.controller;
  const isDial = controller === "Encoder";
  document.getElementById("key-settings").hidden = isDial;
  document.getElementById("dial-settings").hidden = !isDial;
})();
