# NAME
#        dedupe-path.sh — collapse repeated PATH entries
#
# DESCRIPTION
#        Sourced into a shell to keep one entry per directory, the first occurrence
#        of each setting its place.
#
# SEE ALSO
#        Dockerfile

# The list being built and the entries left to read
o3s_path=; o3s_rest=$PATH

# Walk the entries from left to right
while [ -n "$o3s_rest" ]; do
    o3s_entry=${o3s_rest%%:*}
    # Advance to the entries that remain
    case $o3s_rest in *:*) o3s_rest=${o3s_rest#*:} ;; *) o3s_rest= ;; esac
    # Keep the first occurrence of each entry
    case :$o3s_path: in *":$o3s_entry:"*) continue ;; esac
    [ -n "$o3s_entry" ] && o3s_path=${o3s_path:+$o3s_path:}$o3s_entry
done

PATH=$o3s_path
unset o3s_path o3s_rest o3s_entry
