import sys
from google.protobuf import descriptor_pb2

with open('C:/Users/user/Desktop/小樹/tools/goline.proto.bin', 'rb') as f:
    data = f.read()

fds = descriptor_pb2.FileDescriptorSet()
try:
    fds.ParseFromString(data)
    print("Parsed FileDescriptorSet successfully! Files:", len(fds.file))
    for file_proto in fds.file:
        print("Proto file:", file_proto.name, "package:", file_proto.package)
        print("Messages:", len(file_proto.message_type))
        # print message names
        for m in file_proto.message_type:
            if m.name in ['ClientMsg', 'ServerMsg']:
                print(f"Message {m.name} has {len(m.field)} fields:")
                for field in m.field[:10]:
                    print(f"  field {field.number}: {field.name} (type: {field.type})")
except Exception as e:
    # Maybe it's a single FileDescriptorProto instead of FileDescriptorSet?
    fd = descriptor_pb2.FileDescriptorProto()
    fd.ParseFromString(data)
    print("Parsed as FileDescriptorProto! Name:", fd.name, "package:", fd.package)
    print("Messages:", len(fd.message_type))
    for m in fd.message_type:
        if m.name in ['ClientMsg', 'ServerMsg']:
            print(f"Message {m.name} has {len(m.field)} fields:")
            for field in m.field[:15]:
                print(f"  field {field.number}: {field.name} (type: {field.type})")
