import sys
from google.protobuf import descriptor_pb2

with open('C:/Users/user/Desktop/小樹/tools/goline.proto.bin', 'rb') as f:
    data = f.read()

fd = descriptor_pb2.FileDescriptorProto()
fd.ParseFromString(data)

for m in fd.message_type:
    if m.name in ['ClientMsg', 'ServerMsg']:
        print(f"\nMessage {m.name}:")
        print("  oneof_decls:", [o.name for o in m.oneof_decl])
        for field in m.field:
            if field.HasField('oneof_index'):
                print(f"  field {field.number}: {field.name} in oneof[{field.oneof_index}] ({m.oneof_decl[field.oneof_index].name})")
