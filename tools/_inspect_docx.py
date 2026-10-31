import io,sys,zipfile,re
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
z=zipfile.ZipFile('鸦片战争原型·积木小人分件提示词.docx')
x=z.read('word/document.xml').decode('utf-8')
m=re.search(r'<w:sectPr.*?</w:sectPr>',x,re.S)
print('SECTPR:',m.group(0)[:600] if m else 'none')
# first bullet paragraph pPr
i=x.find('尺寸比例')
print('CTX:',x[max(0,i-700):i+80].replace('\n',' ')[:900])
