function create_static_objects() {
    obj = {"apiVersion":"v1","kind":"ServiceAccount","metadata":{"creationTimestamp":null,"name":"myvd-" + k8s_obj.metadata.name}};
    k8s.postWS('/api/v1/namespaces/' + k8s_namespace + '/serviceaccounts',JSON.stringify(obj));

    

    
    

    obj = {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": {
            "labels": {
                "app": "myvd-" + k8s_obj.metadata.name
            },
            "name": "myvd-" + k8s_obj.metadata.name,
            "namespace": k8s_namespace
        },
        "spec": {
            "ports": [
                {
                    "name": "myvd-secure-" + k8s_obj.metadata.name,
                    "port": 636,
                    "protocol": "TCP",
                    "targetPort": 10636
                },
                {
                    "name": "myvd-insecure-" + k8s_obj.metadata.name,
                    "port": 389,
                    "protocol": "TCP",
                    "targetPort": 10389
                }
            ],
            "selector": {
                "app": "myvd-" + k8s_obj.metadata.name
            },
            "sessionAffinity": "ClientIP",
            "sessionAffinityConfig": {
                "clientIP": {
                    "timeoutSeconds": 10800
                }
            },
            "type": "ClusterIP"
        },
        "status": {
            "loadBalancer": {}
        }
    };

    k8s.postWS('/api/v1/namespaces/' + k8s_namespace + '/services',JSON.stringify(obj));

    obj = {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "labels": {
                "app": "myvd-" + k8s_obj.metadata.name
            },
            "name": "myvd-" + k8s_obj.metadata.name,
            "namespace": k8s_namespace
        },
        "spec": {
            "progressDeadlineSeconds": 600,
            "replicas": cfg_obj.replicas,
            "revisionHistoryLimit": 10,
            "selector": {
                "matchLabels": {
                    "app": "myvd-" + k8s_obj.metadata.name
                }
            },
            "strategy": {
                "rollingUpdate": {
                    "maxSurge": "25%",
                    "maxUnavailable": "25%"
                },
                "type": "RollingUpdate"
            },
            "template": {
                "metadata": {
                    "creationTimestamp": null,
                    "labels": {
                        "app": "myvd-" + k8s_obj.metadata.name
                    }
                },
                "spec": {
                    "containers": [
                        {
                            "env": [
                                {
                                    "name": "JAVA_OPTS",
                                    "value": "-Djava.awt.headless=true -Djava.security.egd=file:/dev/./urandom"
                                },
                                {
                                    "name": "fortriggerupdates",
                                    "value": "changeme"
                                }
                            ],
                            "image": cfg_obj.image,
                            "imagePullPolicy": "Always",
                            "livenessProbe" : {
                                "tcpSocket": {
                                    "port": 10389
                                },
                                "failureThreshold": 10,
                                "initialDelaySeconds": 120,
                                "periodSeconds": 10,
                                "successThreshold": 1,
                                "timeoutSeconds": 10
                            },
                            "name": "openunison-" + k8s_obj.metadata.name,
                            "ports": [
                                {
                                    "containerPort": 8080,
                                    "name": "http",
                                    "protocol": "TCP"
                                },
                                {
                                    "containerPort": 8443,
                                    "name": "https",
                                    "protocol": "TCP"
                                }
                            ],
                            "readinessProbe": {
                                "tcpSocket": {
                                    "port": 10389
                                },
                                "failureThreshold": 3,
                                "initialDelaySeconds": 30,
                                "periodSeconds": 10,
                                "successThreshold": 1,
                                "timeoutSeconds": 10
                            },
                            "resources": {},
                            "terminationMessagePath": "/dev/termination-log",
                            "terminationMessagePolicy": "File",
                            "volumeMounts": [
                                {
                                    "mountPath": "/etc/myvd",
                                    "name": "secret-volume",
                                    "readOnly": true
                                },
                                {
                                    "mountPath":"/etc/myvd-config",
                                    "name":"config-volume",
                                    "readOnly": true
                                },
                                {
                                    "mountPath":"/tmp",
                                    "name":"temp-volume"
                                }
                            ]
                        }
                    ],
                    "dnsPolicy": "ClusterFirst",
                    "restartPolicy": "Always",
                    "terminationGracePeriodSeconds": 30,
                    "serviceAccount": "myvd-" + k8s_obj.metadata.name,
                    "volumes": [
                        {
                            "name": "secret-volume",
                            "secret": {
                                "defaultMode": 420,
                                "secretName": cfg_obj.dest_secret
                            }
                        },
                        {
                            "name":"config-volume",
                            "configMap":{
                                "name": cfg_obj.dest_cfg_map
                            }
                        },
                        {
                            "name":"temp-volume",
                            "emptyVolume" : {}
                        }
                    ]
                }
            }
        }
    };

    k8s.postWS('/apis/apps/v1/namespaces/' + k8s_namespace + '/deployments',JSON.stringify(obj));
}


/*
  Uopdate the deployment based on the CRD
*/

function update_k8s_deployment() {
    deployment_info = k8s.callWS('/apis/apps/v1/namespaces/' + k8s_namespace + "/deployments/myvd-" + k8s_obj.metadata.name,"",0);

    if (deployment_info.code == 200) {

        deployment = JSON.parse(deployment_info.data);


        patch = {
            "spec" : {
                "template" : deployment.spec.template                
            }
        };

        if (patch.spec.template.metadata.annotations == null) {
            patch.spec.template.metadata.annotations = {};
        }
        patch.spec.template.metadata.annotations["tremolo.io/update"] = java.util.UUID.randomUUID().toString();

        

        if (deployment.spec.replicas != cfg_obj.replicas) {
            print("Changeing the number of replicas");
            patch.spec['replicas'] = cfg_obj.replicas;
        }

        if (deployment.spec.template.spec.containers[0].image !== cfg_obj.image) {
            print("Changing the image");
            
            patch.spec.template.spec.containers[0].image = cfg_obj.image;
        }

        k8s.patchWS('/apis/apps/v1/namespaces/' + k8s_namespace + "/deployments/myvd-" + k8s_obj.metadata.name,JSON.stringify(patch));
        
    } else {
        print("No deployment found, running create");
        create_static_objects();

    }
}

/*
Deletes objects created by the operator
*/

function delete_k8s_deployment() {
    k8s.deleteWS('/apis/apps/v1/namespaces/' + k8s_namespace + "/deployments/myvd-" + k8s_obj.metadata.name);
    k8s.deleteWS('/api/v1/namespaces/' + k8s_namespace + '/services/myvd-' + k8s_obj.metadata.name);
    k8s.deleteWS('/api/v1/namespaces/' + k8s_namespace + '/serviceaccounts/myvd-' + k8s_obj.metadata.name);

    

    k8s.deleteWS('/api/v1/namespaces/' + k8s_namespace + '/secrets/' + cfg_obj.dest_secret);
    k8s.deleteWS('/api/v1/namespaces/' + k8s_namespace + '/secrets/' + k8s_obj.metadata.name + '-static-keys');
    k8s.deleteWS('/api/v1/namespaces/' + k8s_namespace + '/configmaps/' + cfg_obj.dest_cfg_map);

    print("checking keys");
    for (var i=0;i<cfg_obj.key_store.key_pairs.keys.length;i++) {
        print("key pair : " + i);
        key_data = cfg_obj.key_store.key_pairs.keys[i];
        if (key_data.create_data != null) {
            print("has key");
            secret_name = key_data.name;

            if (key_data.tls_secret_name != null && key_data.tls_secret_name !== "") {
                secret_name = key_data.tls_secret_name;
            }
    
            k8s.deleteWS('/api/v1/namespaces/' + k8s_namespace + '/secrets/' + secret_name);
        }

        
    }

    
}