// Build with:  swiftc tools/html2pdf.swift -o tools/html2pdf
// (scripts/build-guide.mjs does this automatically when tools/html2pdf is missing.)
import Cocoa
import WebKit
import PDFKit

// html2pdf in.html out.pdf : renders 612x792pt pages by slicing the page with WKWebView.createPDF.
// A script pushes block elements down so no line is cut at a page boundary; h1 (not first) starts a page.
let PW: CGFloat = 612, PH: CGFloat = 792, MT: CGFloat = 54, MB: CGFloat = 54

let js = """
(function(){
 var PH=\(Int(PH)), MT=\(Int(MT)), MB=\(Int(MB)), usable=PH-MT-MB;
 var sel='h1,h2,h3,h4,h5,h6,p,li,tr,pre,blockquote,hr,.cover';
 var els=Array.prototype.slice.call(document.querySelectorAll(sel));
 var first=true;
 els.forEach(function(e){
  if(e.closest('li') && e!==e.closest('li') && e.tagName!=='LI') { }
  var r=e.getBoundingClientRect(), top=r.top+window.scrollY, h=r.height;
  var pg=Math.floor(top/PH), pageTop=pg*PH+MT, pageBot=(pg+1)*PH-MB;
  var shift=0;
  var isH1=e.tagName==='H1' && !first;
  if(e.tagName==='H1') first=false;
  var need=h + (/^H[1-6]$/.test(e.tagName)?50:0);
  if(isH1 && top>pageTop+1) shift=(pg+1)*PH+MT-top;
  else if(top<pageTop) shift=pageTop-top;
  else if(top+need>pageBot && h<=usable) shift=(pg+1)*PH+MT-top;
  if(shift>0){
   if(e.tagName==='TR'){ Array.prototype.forEach.call(e.children,function(c){c.style.paddingTop=(parseFloat(getComputedStyle(c).paddingTop)+shift)+'px';}); }
   else { e.style.marginTop=(parseFloat(getComputedStyle(e).marginTop)+shift)+'px'; }
  }
 });
 return Math.ceil(document.documentElement.scrollHeight);
})()
"""

final class Delegate: NSObject, WKNavigationDelegate {
  let out: String
  let web: WKWebView
  let win: NSWindow
  init(out: String, web: WKWebView, win: NSWindow) { self.out = out; self.web = web; self.win = win }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      self.web.evaluateJavaScript(js) { res, err in
        let h = CGFloat((res as? NSNumber)?.doubleValue ?? Double(PH))
        let pages = max(1, Int(ceil(h / PH)))
        self.web.setFrameSize(NSSize(width: PW, height: CGFloat(pages) * PH))
        self.win.setContentSize(NSSize(width: PW, height: CGFloat(pages) * PH))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.slice(0, pages, PDFDocument()) }
      }
    }
  }
  func slice(_ i: Int, _ n: Int, _ doc: PDFDocument) {
    if i >= n {
      let ok = doc.write(to: URL(fileURLWithPath: out))
      print(ok ? "saved \(doc.pageCount) pages" : "failed")
      exit(ok ? 0 : 1)
    }
    let cfg = WKPDFConfiguration()
    cfg.rect = CGRect(x: 0, y: CGFloat(i) * PH, width: PW, height: PH)
    web.createPDF(configuration: cfg) { r in
      if case .success(let data) = r, let d = PDFDocument(data: data), let p = d.page(at: 0) {
        doc.insert(p, at: doc.pageCount)
      } else { print("slice \(i) failed"); exit(1) }
      self.slice(i + 1, n, doc)
    }
  }
}

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: html2pdf in.html out.pdf"); exit(1) }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: PW, height: PH))
let win = NSWindow(contentRect: NSRect(x: -5000, y: -5000, width: PW, height: PH), styleMask: [.borderless], backing: .buffered, defer: false)
win.contentView = web
win.orderBack(nil)
let d = Delegate(out: args[2], web: web, win: win)
web.navigationDelegate = d
let url = URL(fileURLWithPath: args[1])
web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 120) { print("timeout"); exit(2) }
app.run()
