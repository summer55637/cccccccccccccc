import sys
from google.protobuf import descriptor_pb2

with open('C:/Users/user/Desktop/小樹/tools/goline.proto.bin', 'rb') as f:
    data = f.read()

fd = descriptor_pb2.FileDescriptorProto()
fd.ParseFromString(data)

type_names = {
    1: 'double', 2: 'float', 3: 'int64', 4: 'uint64', 5: 'int32',
    6: 'fixed64', 7: 'fixed32', 8: 'bool', 9: 'string', 10: 'group',
    11: 'message', 12: 'bytes', 13: 'uint32', 14: 'enum', 15: 'sfixed32',
    16: 'sfixed64', 17: 'sint32', 18: 'sint64'
}

label_names = {
    1: 'optional', 2: 'required', 3: 'repeated'
}

lines = []
lines.append('syntax = "proto3";\n')
if fd.package:
    lines.append(f'package {fd.package};\n')

for enum in fd.enum_type:
    lines.append(f'enum {enum.name} {{')
    for val in enum.value:
        lines.append(f'  {val.name} = {val.number};')
    lines.append('}\n')

def format_message(m, indent=""):
    res = []
    res.append(f'{indent}message {m.name} {{')
    
    # nested enums
    for enum in m.enum_type:
        res.append(f'{indent}  enum {enum.name} {{')
        for val in enum.value:
            res.append(f'{indent}    {val.name} = {val.number};')
        res.append(f'{indent}  }}')

    # nested messages
    for nested in m.nested_type:
        res.extend(format_message(nested, indent + "  "))

    # fields
    for field in m.field:
        t_name = type_names.get(field.type, 'unknown')
        if field.type in [11, 14]:
            t_name = field.type_name.split('.')[-1]
        
        lbl = ""
        if field.label == 3:
            lbl = "repeated "
        
        oneof_str = ""
        res.append(f'{indent}  {lbl}{t_name} {field.name} = {field.number};')
    res.append(f'{indent}}}\n')
    return res

for m in fd.message_type:
    lines.extend(format_message(m))

with open('C:/Users/user/Desktop/小樹/tools/goline.proto', 'w', encoding='utf-8') as out:
    out.write('\n'.join(lines))

print("Successfully written goline.proto! Total messages:", len(fd.message_type))
