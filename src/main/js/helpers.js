//Helper Functions
/*
 Create properties map from the non-secret portion of the CR
*/
function props_from_crd() {
    props = {};

    for (i=0;i<cfg_obj.non_secret_data.length;i++) {
        props[cfg_obj.non_secret_data[i].name] = cfg_obj.non_secret_data[i].value;
    }

    return props;

}



/*
  Updates properties with values from the source secret
*/
function props_from_secret() {
    results = k8s.callWS("/api/v1/namespaces/" + k8s_namespace + "/secrets/" + cfg_obj.source_secret);
    if (results.code == 200) {
        secret = JSON.parse(results.data);
        for (i=0;i<cfg_obj.secret_data.length;i++) {
            for (var property in secret.data) {
                if (secret.data.hasOwnProperty(property)) {
                    if (property === cfg_obj.secret_data[i]) {
                        inProp[cfg_obj.secret_data[i]] = new java.lang.String(java.util.Base64.getDecoder().decode(secret.data[property])).trim();
                    }
                }
            }

           
        }
        return true;
    } else {
        print("The source secret '" + cfg_obj.source_secret + "' does not exist.  Please create it.");
        return false;
    }
}

/*
    checks if a value is a "script" 
*/
function script_val(cfg_option) {
    cfg_option_val = cfg_option;
    if (cfg_option_val.startsWith('${')) {
        cfg_option_val_script = cfg_option_val.substring(2,cfg_option_val.length - 1);
        cfg_option_val = js.eval(cfg_option_val_script);
    }

    return cfg_option_val;
}

/*
Process a key pair configuration
*/
function process_key_pair_config(key_config) {
    print("\n\nProcessing key '" + key_config.name + "'");
    create_keypair_template = cfg_obj.key_store.key_pairs.create_keypair_template;

    secret_info = key_config.create_data.secret_info;

    if (secret_info == null) {
        secret_info = {};
        secret_info['type_of_secret'] = 'kubernetes.io/tls';
        secret_info['cert_name'] = 'tls.crt';
        secret_info['key_name'] = 'tls.key';
    }

    //determine the namespace of the secret
    target_ns = k8s_namespace;
    if (key_config.create_data.target_namespace != null && key_config.create_data.target_namespace !== "") {
        target_ns = key_config.create_data.target_namespace;
    }

    var secret_name = "";
    if (key_config.tls_secret_name != null && key_config.tls_secret_name !== "") {
        secret_name = key_config.tls_secret_name;
    } else {
        secret_name = key_config.name;
    }

    //check if the secret already exists
    print("Checking if kubernetes secret exists")
    secret_response = k8s.callWS("/api/v1/namespaces/" + target_ns + "/secrets/" + secret_name,"",-1);
    secret_exists = false;

    if (secret_response.code == 200) {
        print("Secret exists")
        secret_json = JSON.parse(secret_response.data);
        if (! key_config.replace_if_exists) {
            print("Adding existing secret to keystore");
            
            if (key_config.import_into_ks == null || key_config.import_into_ks === "" || key_config.import_into_ks === "keypair") {
                print("Storing to keystore");
                CertUtils.importKeyPairAndCert(ouKs,ksPassword,key_config.name,secret_json.data[secret_info.key_name],secret_json.data[secret_info.cert_name]);
            } else if (key_config.import_into_ks === "certificate") {
                print("Storing just the certificate2");
                CertUtils.importCertificate(ouKs,ksPassword,key_config.name,new java.lang.String(java.util.Base64.getDecoder().decode(secret_json.data[secret_info.cert_name])));
            } else {
                print("Not storing at all");
            }

            

            return;
        } else {
            if (secret_json.metadata.labels != null && secret_json.metadata.labels['tremolo_operator_created'] != null) {
                print("Adding existing secret to keystore");
                
                if (key_config.import_into_ks == null || key_config.import_into_ks === "" || key_config.import_into_ks === "keypair") {
                    print("Storing to keystore");
                    CertUtils.importKeyPairAndCert(ouKs,ksPassword,key_config.name,secret_json.data[secret_info.key_name],secret_json.data[secret_info.cert_name]);
                } else if (key_config.import_into_ks === "certificate") {
                    print("Storing just the certificate3");
                    CertUtils.importCertificate(ouKs,ksPassword,key_config.name,new java.lang.String(java.util.Base64.getDecoder().decode(secret_json.data[secret_info.cert_name])));
                } else {
                    print("Not storing at all");
                }

                return;
            }
        }

        secret_exists = true;
    }

    print("Creating keypair");

    //time to create the keypair
    //process the create template and the ca cert flag
    certInfo = {};
    for (var i=0;i<create_keypair_template.length;i++) {
        certInfo[create_keypair_template[i].name] = create_keypair_template[i].value;
    }
    certInfo["caCert"] = key_config.create_data.ca_cert;
    certInfo["size"] = key_config.create_data.key_size;

    //figure out the server name/cn and subject alternative names
    server_name = script_val(key_config.create_data.server_name);
    certInfo["serverName"] = server_name;

    if (key_config.create_data.subject_alternative_names != null && key_config.create_data.subject_alternative_names.length > 0) {
        certInfo["subjectAlternativeNames"] = [];
        for (i=0;i<key_config.create_data.subject_alternative_names.length;i++) {
            certInfo["subjectAlternativeNames"].push(script_val(key_config.create_data.subject_alternative_names[i]));
        }
    }


    x509data = CertUtils.createCertificate(certInfo);

    if (key_config.create_data.sign_by_k8s_ca) {
        print("Signing by Kubernetes' CA");
        csrReq = {
            "apiVersion": "certificates.k8s.io/v1beta1",
            "kind": "CertificateSigningRequest",
            "metadata": {
              "name": server_name,
            },
            "spec": {
              "request": java.util.Base64.getEncoder().encodeToString(CertUtils.generateCSR(x509data).getBytes("utf-8")),
              "usages": [
                "digital signature",
                "key encipherment",
                "server auth"
              ]
            }
        };

        print("Posting CSR");
        apiResp = k8s.postWS('/apis/certificates.k8s.io/v1beta1/certificatesigningrequests',JSON.stringify(csrReq));

        if (apiResp.code == 409) {
            print("Existing CSR, deleting");
            k8s.deleteWS('/apis/certificates.k8s.io/v1beta1/certificatesigningrequests/' + server_name);
            apiResp = k8s.postWS('/apis/certificates.k8s.io/v1beta1/certificatesigningrequests',JSON.stringify(csrReq));
        }

        approveReq = JSON.parse(apiResp.data);
        approveReq.status.conditions = [
            {
                "type":"Approved",
                "reason":"OpenUnison Deployment",
                "message":"This CSR was approved by the OpenUnison operator"
            }
        ];

        print("Approving CSR");
        apiResp = k8s.putWS('/apis/certificates.k8s.io/v1beta1/certificatesigningrequests/' + server_name + '/approval',JSON.stringify(approveReq));
        
        print("Retrieving signed certificate");
        apiResp = k8s.callWS('/apis/certificates.k8s.io/v1beta1/certificatesigningrequests/' + server_name);

        certResp = JSON.parse(apiResp.data);
        b64cert = certResp.status.certificate;

        if (b64cert == null || b64cert === "") {
            print("CertManager is not enabled on this cluster.  Change sign_by_k8s_cluster to false");
            exit(1);
        }

        CertUtils.importSignedCert(x509data,b64cert);

        


    }

    //create tls secret
    print("Creating secret");
    

    secret_to_create = {
        "apiVersion":"v1",
        "kind":"Secret",
        "type":secret_info.type_of_secret,
        "metadata": {
            "name": secret_name,
            "namespace": target_ns,
            "labels": {
                "tremolo_operator_created":"true"
            }
        },
        "data":{
            
        }
    };

    secret_to_create.data[ secret_info.cert_name ] = java.util.Base64.getEncoder().encodeToString(CertUtils.exportCert(x509data.getCertificate()).getBytes("UTF-8"));
    secret_to_create.data[ secret_info.key_name ] = java.util.Base64.getEncoder().encodeToString(CertUtils.exportKey(x509data.getKeyData().getPrivate()).getBytes("UTF-8"));


    if (secret_exists) {
        print("Deleting existing secret");
        k8s.deleteWS("/api/v1/namespaces/" + target_ns + "/secrets/" + secret_name);
    }

    print("Posting secret");
    k8s.postWS('/api/v1/namespaces/' + target_ns + '/secrets',JSON.stringify(secret_to_create));

    
    if (key_config.import_into_ks == null || key_config.import_into_ks === "" || key_config.import_into_ks === "keypair") {
        print("Storing to keystore");
        CertUtils.saveX509ToKeystore(ouKs,ksPassword,key_config.name,x509data);
    } else if (key_config.import_into_ks === "certificate") {
        print("Storing just the certificate1");
        CertUtils.importCertificate(ouKs,ksPassword,key_config.name,x509data.getCertificate());
    } else {
        print("Not storing at all");
    }
    
    
    print("Key '" + key_config.name + "' finished");





}

function process_static_keys() {
    var static_keys = {};
    //get the existing secret
    secret_uri = "/api/v1/namespaces/" + k8s_namespace + "/secrets/" + k8s_obj.metadata.name + '-static-keys';
    secret_response = k8s.callWS(secret_uri,"",-1);

    if (secret_response.code == 200) {
        print("Secret exists, deleting");
        k8s.deleteWS(secret_uri);

        secret_json = JSON.parse(secret_response.data);
        for (var property in secret_json.data) {
            if (secret_json.data.hasOwnProperty(property)) {
                static_key = JSON.parse(new java.lang.String(java.util.Base64.getDecoder().decode(secret_json.data[property])));
                static_keys[static_key.name] = static_key;
                static_key['still_used'] = false;
            }
        }
    }

    for (var i=0;i<cfg_obj.key_store.static_keys.length;i++) {
        static_key_config = cfg_obj.key_store.static_keys[i];
        static_key_config_from_secret = static_keys[static_key_config.name];

        if (static_key_config_from_secret == null) {
            //the static key doesn't exist in the secret, create it
            CertUtils.createKey(ouKs,static_key_config.name,ksPassword);
            static_keys[static_key_config.name] = {
                "name":static_key_config.name,
                "version":1,
                "key_data": CertUtils.exportKey(ouKs,static_key_config.name,ksPassword),
                "still_used": true

            };

        } else if (static_key_config_from_secret.version != static_key_config.version) {
            //exists, but needs to be updated
            CertUtils.createKey(ouKs,static_key_config.name,ksPassword);
            static_keys[static_key_config.name] = {
                "name":static_key_config.name,
                "version":static_key_config.version,
                "key_data": CertUtils.exportKey(ouKs,static_key_config.name,ksPassword),
                "still_used": true

            };
        } else  {
            //import key from secret
            static_key_config_from_secret.still_used = true;
            CertUtils.storeKey(ouKs,static_key_config.name,ksPassword,static_key_config_from_secret.key_data);
        }
        

    }

    secret_to_create = {
        "apiVersion":"v1",
        "kind":"Secret",
        "type":"Opaque",
        "metadata": {
            "name": k8s_obj.metadata.name + '-static-keys',
            "namespace": k8s_namespace
        },
        "data":{
            
        }
    };

    for (var key_name in static_keys) {
        if (static_keys.hasOwnProperty(key_name)) {
            if (static_keys[key_name].still_used) {
                secret_to_create.data[key_name] = java.util.Base64.getEncoder().encodeToString(JSON.stringify(static_keys[key_name]).getBytes("UTF-8"));
            }
        }
    }

    print("Posting secret");
    k8s.postWS('/api/v1/namespaces/' + k8s_namespace + '/secrets',JSON.stringify(secret_to_create));


    

}

/*
  Generate openunison secret
*/
function generate_myvd_secret(event_json) {
    inProp = props_from_crd();
    if (! props_from_secret()) {
        return false;
    }
    

    

    print("Creating myvd keystore");

    ksPassword = new java.lang.String(inProp['MYVD_TLS_KEY_PASSWORD']);
    ouKs = Java.type("java.security.KeyStore").getInstance("PKCS12");
    ouKs.load(null,ksPassword.toCharArray());

    print("Storing k8s certificate");
    //ouKs.setCertificateEntry('k8s-master',k8s.getCertificate('k8s-master'));

    CertUtils.importCertificate(ouKs,ksPassword,'k8s-master',k8s.getCaCert());

    print("Storing trusted certificates");
    for (i=0;i<cfg_obj.key_store.trusted_certificates.length;i++) {
        CertUtils.importCertificate(ouKs,ksPassword,cfg_obj.key_store.trusted_certificates[i].name,cfg_obj.key_store.trusted_certificates[i].pem_data);
    }

    print("Processing keypairs");
    
    print("Number of keys : '" + cfg_obj.key_store.key_pairs.keys.length + "'");
    
    for (var i=0;i<cfg_obj.key_store.key_pairs.keys.length;i++) {
        print(i);
        key_config = cfg_obj.key_store.key_pairs.keys[i];
        key_config.name = script_val(key_config.name);
        process_key_pair_config(key_config);
        print(i);
    }

    process_static_keys();

    //check to see if the secret already exists
    existing_secret = k8s.callWS('/api/v1/namespaces/' + k8s_namespace + '/secrets/' + cfg_obj.dest_secret,"",-1);
    if (existing_secret.code == 200) {
        //patch the existing secret
        secret_patch = {
            "data":{
                "myvd.env" : k8s.encodeMap(inProp),
                "myvd.p12" : CertUtils.encodeKeyStore(ouKs,ksPassword)
                
            }
        };

        k8s.patchWS('/api/v1/namespaces/' + k8s_namespace + '/secrets/' + cfg_obj.dest_secret,JSON.stringify(secret_patch));

    } else {
        //create a new secret
        new_secret = {
            "apiVersion":"v1",
            "kind":"Secret",
            "type": 'Opaque',
            "metadata": {
                "name": cfg_obj.dest_secret,
                "namespace": k8s_namespace,
            },
            "data":{
                "myvd.env" : k8s.encodeMap(inProp),
                "myvd.p12" : CertUtils.encodeKeyStore(ouKs,ksPassword)
                
            }
        };
        
        //post the secret
        k8s.postWS('/api/v1/namespaces/' + k8s_namespace + '/secrets',JSON.stringify(new_secret));
    }



    print("Done");

    return true;
}


function generate_myvd_configmap() {
    //check to see if the secret already exists
    existing_cfg_map = k8s.callWS('/api/v1/namespaces/' + k8s_namespace + '/configmaps/' + cfg_obj.dest_cfg_map,"",-1);
    if (existing_cfg_map.code == 200) {
        //patch the existing secret
        cfg_patch = {
            "data":{
                "myvd.yaml": k8s.json2yaml(JSON.stringify(cfg_obj.myvd_network_configuration) ),
                "myvd.conf" : cfg_obj.myvd_props,
                "log4j2.xml" : cfg_obj.myvd_log4j2_xml
                
            }
        };

        k8s.patchWS('/api/v1/namespaces/' + k8s_namespace + '/configmaps/' + cfg_obj.dest_cfg_map,JSON.stringify(cfg_patch));

    } else {
        //create a new configmap
        new_cfg_map = {
            "apiVersion":"v1",
            "kind":"ConfigMap",
            "metadata": {
                "name": cfg_obj.dest_cfg_map,
                "namespace": k8s_namespace,
            },
            "data":{
                "myvd.yaml": k8s.json2yaml(JSON.stringify(cfg_obj.myvd_network_configuration) ),
                "myvd.conf" : cfg_obj.myvd_props,
                "log4j2.xml" : cfg_obj.myvd_log4j2_xml
                
            }
        };
        
        //post the secret
        k8s.postWS('/api/v1/namespaces/' + k8s_namespace + '/configmaps',JSON.stringify(new_cfg_map));
    }
}