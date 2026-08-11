#!/usr/bin/env python3
"""FD-only copier for attested preview artifacts."""
import errno, os, shutil, stat, sys
N = getattr(os, "O_NOFOLLOW", 0); D = getattr(os, "O_DIRECTORY", 0)
def fail(s): raise SystemExit("preview tree " + s)
def norm(parent, target):
    if target.startswith('/'): fail('symlink escapes source')
    out = list(parent)
    for p in target.split('/'):
        if p in ('', '.'): continue
        if p == '..':
            if not out: fail('symlink escapes source')
            out.pop()
        else: out.append(p)
    return out
def openat(root, parts):
    fd=os.dup(root)
    try:
        for i,p in enumerate(parts):
            nfd=os.open(p, os.O_RDONLY|N|(D if i<len(parts)-1 else 0), dir_fd=fd); os.close(fd); fd=nfd
        return fd
    except OSError as e:
        os.close(fd)
        if e.errno in (errno.ELOOP,errno.ENOENT,errno.ENOTDIR): fail('has dangling, escaping, or chained symlink target')
        raise
def mkdirat(fd,name):
    try: os.mkdir(name, 0o700, dir_fd=fd)
    except FileExistsError: pass
    try: return os.open(name,os.O_RDONLY|D|N,dir_fd=fd)
    except OSError as e:
        if e.errno in (errno.ELOOP,errno.ENOTDIR): fail('destination has symlink or non-directory')
        raise
def dest(root, relative):
    fd=os.dup(root)
    for p in relative:
        nfd=mkdirat(fd,p); os.close(fd); fd=nfd
    return fd
def checked(fd,name,flags,old):
    new=os.open(name,flags|N,dir_fd=fd); now=os.fstat(new)
    if (now.st_dev,now.st_ino,stat.S_IFMT(now.st_mode)) != (old.st_dev,old.st_ino,stat.S_IFMT(old.st_mode)) or (stat.S_ISREG(now.st_mode) and now.st_nlink!=1): os.close(new); fail('changed, hard-linked, or nonregular during copy')
    return new
def filecopy(srcfd,dstfd,name):
    out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|N,0o600,dir_fd=dstfd)
    with os.fdopen(srcfd,'rb') as s, os.fdopen(out,'wb') as d: shutil.copyfileobj(s,d)
def tree(root,src,parts,dst,seen):
    inode=(os.fstat(src).st_dev,os.fstat(src).st_ino)
    if inode in seen: fail('symlink creates directory cycle')
    seen=seen|{inode}
    for e in os.scandir(src):
        old=os.stat(e.name,dir_fd=src,follow_symlinks=False); targetparts=parts
        if stat.S_ISLNK(old.st_mode):
            targetparts=norm(parts,os.readlink(e.name,dir_fd=src)); fd=openat(root,targetparts); old=os.fstat(fd)
        elif stat.S_ISREG(old.st_mode): fd=checked(src,e.name,os.O_RDONLY,old)
        elif stat.S_ISDIR(old.st_mode): fd=checked(src,e.name,os.O_RDONLY|D,old)
        else: fail('contains nonregular object')
        if stat.S_ISREG(old.st_mode): filecopy(fd,dst,e.name)
        elif stat.S_ISDIR(old.st_mode):
            child=mkdirat(dst,e.name); tree(root,fd,targetparts if e.is_symlink() else parts+[e.name],child,seen); os.close(fd); os.close(child)
        else: os.close(fd); fail('symlink targets nonregular object')
def main():
    if len(sys.argv)!=4: fail('copier arguments are invalid')
    source,release,relative=sys.argv[1:]; parts=[] if relative=='.' else relative.split('/')
    if any(p in ('','.', '..') for p in parts): fail('destination is invalid')
    s=os.open(source,os.O_RDONLY|D|N); d=os.open(release,os.O_RDONLY|D|N)
    try: tree(s,s,[],dest(d,parts),set())
    finally: os.close(s); os.close(d)
if __name__=='__main__': main()
