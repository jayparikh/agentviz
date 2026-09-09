export function downloadText(text: string, filename: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  let appended = false;
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    appended = true;
    anchor.click();
  } finally {
    if (appended) document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
