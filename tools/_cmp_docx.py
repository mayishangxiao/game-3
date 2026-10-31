import io,sys,zipfile,re
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
for f in ['党史像素RPG游戏·完整设计书 v2.0.docx','鸦片战争原型·美术生成提示词.docx','鸦片战争原型·积木小人分件提示词.docx']:
    try:
        z=zipfile.ZipFile(f); x=z.read('word/document.xml').decode('utf-8')
        m=re.search(r'<w:sectPr.*?</w:sectPr>',x,re.S)
        print(f,'->',m.group(0)[:400] if m else 'none'); print()
    except Exception as e:
        print(f,'ERR',e)
