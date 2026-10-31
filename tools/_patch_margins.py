import io,sys
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
p='build_part_prompts.py'
t=open(p,encoding='utf-8').read()
t=t.replace("sec.left_margin = Cm(2.2)\n    sec.right_margin = Cm(2.2)","sec.left_margin = Cm(2.4)\n    sec.right_margin = Cm(2.4)\n    sec.page_width = Cm(21.0)\n    sec.page_height = Cm(29.7)")
open(p,'w',encoding='utf-8',newline='\n').write(t)
print('patched')
