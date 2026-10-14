import sys
pages = [
 ["Deep Residual Learning for Image Segmentation", "", "Abstract", "Medical image segmentation models often perform well on data from the", "same distribution as their training set. However, their performance may", "degrade when deployed in a different clinical environment. Domain shift", "refers to a change in the data distribution between source and target", "domains. In this paper we study this effect on three public datasets.", "", "1. Introduction", "Consider a model trained on images acquired at Hospital A. Images from", "Hospital B may differ in scanner settings, patient populations, or", "acquisition protocols. These differences can change image appearance", "without changing the underlying segmentation task."],
 ["2. Method", "We adopt a U-Net backbone with residual blocks and train with Dice loss.", "Test-time augmentation is applied to estimate predictive uncertainty.", "Let x denote the input image and y the segmentation mask. We minimize", "L = 1 - 2|P ∩ G| / (|P| + |G|) over the training set.", "", "3. Experiments", "To assess generalization, we evaluate the model on independent target", "domain data and compare its performance with a source domain baseline.", "A change in image appearance alone does not tell us how much the", "segmentation performance will decrease; this requires experimental", "evidence. Results are summarized in Table 1."],
]
def esc(s):
    return s.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
objs = []
# 1 catalog, 2 pages, 3 font, then page+content pairs
objs.append("<< /Type /Catalog /Pages 2 0 R >>")
page_ids = []
n = 4
for i in range(len(pages)):
    page_ids.append(n)
    n += 2
objs.append("<< /Type /Pages /Kids [" + " ".join(f"{pid} 0 R" for pid in page_ids) + "] /Count " + str(len(pages)) + " >>")
objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
for i, lines in enumerate(pages):
    content = "BT /F1 12 Tf 72 740 Td 16 TL\n"
    for ln in lines:
        safe = ln.encode('cp1252', 'replace').decode('cp1252')
        content += "(" + esc(safe) + ") Tj T*\n"
    content += "ET"
    cbytes = content.encode('cp1252', 'replace')
    objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_ids[i]+1} 0 R >>")
    objs.append(("<< /Length " + str(len(cbytes)) + " >>\nstream\n").encode('latin-1') + cbytes + b"\nendstream")
out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
offsets = []
for i, o in enumerate(objs, start=1):
    offsets.append(len(out))
    out += f"{i} 0 obj\n".encode('latin-1')
    out += o if isinstance(o, bytes) else o.encode('latin-1')
    out += b"\nendobj\n"
xref = len(out)
out += f"xref\n0 {len(objs)+1}\n".encode('latin-1')
out += b"0000000000 65535 f \n"
for off in offsets:
    out += f"{off:010d} 00000 n \n".encode('latin-1')
out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode('latin-1')
open(sys.argv[1], 'wb').write(out)
print("wrote", sys.argv[1], len(out), "bytes")
