FROM ubuntu:18.04

MAINTAINER Tremolo Security, Inc. - Docker <docker@tremolosecurity.com>

ENV JDK_VERSION=1.8.0 \
    MYVD_OPERATOR_VERSION=1.0.0 

LABEL io.k8s.description="MyVirtualDirectory operator" \
      io.k8s.display-name="MyVirtualDirectory Operator" 

RUN apt-get update;apt-get -y install openjdk-8-jdk-headless curl apt-transport-https gnupg && \
    curl -s https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add - && \
    echo "deb http://apt.kubernetes.io/ kubernetes-xenial main" > /etc/apt/sources.list.d/kubernetes.list && \
    apt-get update; apt-get install -y kubectl ; apt-get -y upgrade;apt-get clean;rm -rf /var/lib/apt/lists/*; \
    groupadd -r myvd -g 433 && \
    mkdir /usr/local/myvd && \
    useradd -u 431 -r -g myvd -d /usr/local/myvd -s /sbin/nologin -c "MyVirtualDirectory Operator image user" myvd && \
    curl https://nexus.tremolo.io/repository/betas/com/tremolosecurity/kubernetes/javascript-operator/$MYVD_OPERATOR_VERSION/javascript-operator-$MYVD_OPERATOR_VERSION.jar -o /usr/local/myvd/javascript-operator.jar

ADD src/main/js /usr/local/myvd/js

RUN chown -R myvd:myvd /usr/local/myvd 


USER 431

CMD ["/usr/bin/java", "-jar", "/usr/local/myvd/javascript-operator.jar"]

