import io,sys,zipfile,re
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
z=zipfile.ZipFile('鸦片战争原型·积木小人分件提示词.docx')
x=z.read('word/document.xml').decode('utf-8')
print(re.search(r'<w:pgSz[^>]*>',x).group(0))
print(re.search(r'<w:pgMar[^>]*>',x).group(0))
s=z.read('word/styles.xml').decode('utf-8')
m=re.search(r'<w:style [^>]*w:styleId="Normal".*?</w:style>',s,re.S)
print(m.group(0)[:800] if m else 'no normal')
