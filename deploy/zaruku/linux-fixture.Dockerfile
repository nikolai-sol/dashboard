FROM docker.io/library/node@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96

# Preparation only. The runtime has no network and never invokes the package manager.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
    && node -e "require('node:fs').writeFileSync('/tmp/fixture-ca.pem', require('node:tls').rootCertificates.join('\n'))" \
    && printf '%s\n' 'Acquire::https::CaInfo "/tmp/fixture-ca.pem";' > /etc/apt/apt.conf.d/fixture-ca \
    && printf '%s\n' 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20260825T000000Z bookworm main' > /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false -o APT::Update::Error-Mode=any update \
    && apt-get install -y --no-install-recommends python3=3.11.2-1+b1 util-linux=2.38.1-5+deb12u3 passwd=1:4.13+dfsg1-1+deb12u2 \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /tmp/fixture-ca.pem /etc/apt/apt.conf.d/fixture-ca \
    && mkdir -p /opt/fixture-system \
    && cp -a /etc /opt/fixture-system/etc \
    && cp -a /usr/bin /opt/fixture-system/usr-bin \
    && test -x /usr/bin/python3 && test -x /usr/bin/setpriv \
    && test -x /usr/sbin/useradd && test -x /usr/sbin/groupadd

ENTRYPOINT ["/usr/local/bin/node"]
