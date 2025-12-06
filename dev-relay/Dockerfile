FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git \
    g++ \
    make \
    cmake \
    libssl-dev \
    zlib1g-dev \
    liblmdb-dev \
    libflatbuffers-dev \
    libzstd-dev \
    build-essential \
    autoconf \
    libtool \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/bitcoin-core/secp256k1.git /tmp/secp256k1 && \
    cd /tmp/secp256k1 && \
    ./autogen.sh && \
    ./configure --enable-module-recovery --enable-module-schnorrsig && \
    make && \
    make install && \
    ldconfig && \
    rm -rf /tmp/secp256k1

WORKDIR /build
RUN git clone https://github.com/hoytech/strfry.git
WORKDIR /build/strfry

RUN git submodule update --init

RUN make setup-golpe && make -j$(nproc)

FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    libssl3 \
    zlib1g \
    liblmdb0 \
    libflatbuffers1 \
    libzstd1 \
    bash \
    coreutils \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/libsecp256k1* /usr/local/lib/
RUN ldconfig

COPY --from=builder /build/strfry/strfry /usr/local/bin/strfry

COPY --from=builder /build/strfry/strfry.conf /app/strfry.conf

WORKDIR /app

EXPOSE 7777

CMD ["strfry", "relay", "--config", "/app/strfry.conf"]
